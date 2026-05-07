import type {
  AssistantInjectionMessage,
  ChartRequestMessage,
  ChartResponseOutput,
  MessageId,
  SessionId,
  UpdateReason,
} from '@maelstrom-co/protocol';

import type { AsyncMutex } from './async-mutex.js';
import { createAsyncMutex } from './async-mutex.js';
import type {
  GetResponseByIdResult,
  HistoryEntry,
  HistoryStore,
} from './history-store.js';
import { truncate } from './truncation.js';

/**
 * Slim, role-tagged shape used by the prompt builder when it needs to embed
 * prior conversation in the next LLM turn.
 */
export interface LLMContextMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface HistoryConfig<TMeta = unknown> {
  /**
   * Hard cap on per-session entry count. Omit to disable the entry-count
   * cap entirely — truncation then relies solely on `maxChars` (or becomes
   * a no-op if that is also omitted).
   */
  readonly maxEntries?: number;
  /**
   * Budget for total chars across retained entries — a token proxy. Omit
   * to disable the char budget entirely.
   */
  readonly maxChars?: number;
  /**
   * Optional per-entry transform applied before persistence. Runs for both
   * `turn` and `injection` entries. Use to strip fields a production store
   * doesn't need (rationale, vessel snapshots, etc.) — or to enrich entries
   * with typed `metadata` before they're stored.
   */
  readonly transformEntry?: (entry: HistoryEntry<TMeta>) => HistoryEntry<TMeta>;
  /**
   * Optional projection from a stored entry to the LLM-context messages it
   * contributes. Called once per retained entry during `getLLMContext` and
   * once per entry during truncation cost estimation. When omitted, the
   * engine uses its default projection: turns produce a user message (from
   * user_intent reasons) + an assistant message (from the response's
   * userMessage); injections produce a single assistant message.
   *
   * Override to expose richer stored `metadata` to the LLM, rewrite roles,
   * or merge multiple entries into a single context message.
   */
  readonly deriveLLMContext?: (
    entry: HistoryEntry<TMeta>,
  ) => readonly LLMContextMessage[];
  /**
   * Backing store. Required — the engine never silently defaults to an
   * in-process store. Local dev and tests should pass `createInMemoryStore()`
   * explicitly; production deployments supply a persistent, atomic store.
   * Making this explicit prevents the footgun of shipping a configured
   * `history` block to production and silently losing every session on
   * process restart.
   */
  readonly store: HistoryStore<TMeta>;
}

/**
 * Per-session conversation history coordinator. Wraps a {@link HistoryStore}
 * with the session-scoped policy the engine pipeline needs:
 *
 * - {@link recordTurn} writes a completed `chart_request` turn under a
 *   per-session async mutex, then truncates the session against the
 *   `maxEntries` / `maxChars` budgets.
 * - {@link addAssistantMessage} persists a developer-supplied assistant
 *   message lock-free; idempotency is delegated to the store.
 * - {@link getLLMContext} projects retained entries into the slim
 *   `LLMContextMessage[]` shape the prompt builder consumes.
 *
 * `createEngine` constructs one of these internally when {@link HistoryConfig}
 * is supplied; consumers building a custom engine pipeline can construct it
 * directly via {@link createHistoryManager}.
 *
 * Concurrency note: the per-session mutex is process-local. Distributed
 * deployments must serialize `chart_request` turns externally (sticky
 * routing, distributed lease, etc.) — see the README's Concurrency section.
 */
export interface HistoryManager<TMeta = unknown> {
  recordTurn(
    input: ChartRequestMessage,
    output: ChartResponseOutput,
  ): Promise<void>;
  /**
   * Persist a developer-supplied assistant message into history.
   *
   * **Ordering.** The store append is lock-free, so `addAssistantMessage`
   * does not queue behind a long-running `recordTurn`. Callers that need an
   * injection to be visible to the next `chart_request` must `await` the
   * returned promise before issuing that request — the await is the
   * ordering primitive, not internal serialization. Concurrent unawaited
   * calls have no ordering guarantee against `recordTurn` reads.
   *
   * Truncation, separately, runs under the per-session mutex so injection
   * truncation and turn truncation cannot race their `store.replace` calls.
   */
  addAssistantMessage(
    input: AssistantInjectionMessage,
  ): Promise<{ readonly inserted: boolean }>;
  getHistory(sessionId: SessionId): Promise<readonly HistoryEntry<TMeta>[]>;
  getLLMContext(sessionId: SessionId): Promise<readonly LLMContextMessage[]>;
  clear(sessionId: SessionId): Promise<void>;
  /**
   * Point-lookup of a previously recorded `turn`'s response. Pure passthrough
   * to {@link HistoryStore.getResponseById}; lock-free read. See
   * {@link GetResponseByIdResult} for the three outcomes (`hit`, `miss`,
   * `kind-mismatch`).
   */
  getResponseById(
    sessionId: SessionId,
    messageId: MessageId,
  ): Promise<GetResponseByIdResult>;
}

/**
 * Construct a {@link HistoryManager} from the given config. The passed-in
 * {@link HistoryStore} is the only persistence boundary; this manager adds
 * per-session mutual exclusion (for `recordTurn`), truncation policy, and
 * the default LLM-context projection on top.
 *
 * Most consumers should let `createEngine` wire this up via
 * {@link EngineConfig.history}. Construct directly only when assembling a
 * custom engine pipeline that needs the manager outside `createEngine`.
 */
export function createHistoryManager<TMeta = unknown>(
  config: HistoryConfig<TMeta>,
): HistoryManager<TMeta> {
  const store = config.store;
  const deriveLLMContext = config.deriveLLMContext ?? defaultDeriveLLMContext;
  // TODO(multi-instance): per-session mutex is process-local.
  // Failure mode: two instances racing on the same session can interleave
  // the read-truncate-replace sequence inside `recordTurn`. The
  // `HistoryStore.append` atomicity contract protects single-entry writes
  // (`assistant_message` dedup), but the truncation pass `entries → prune
  // → store.replace(entries')` is a multi-step compare-and-swap that
  // {@link AsyncMutex} only serializes within one process. Across
  // instances the second writer can clobber the first writer's truncation,
  // resurrecting evicted entries or duplicating retained ones.
  // Substrate: shared lease (Redis Redlock or backend-native row lock)
  // keyed by `sessionId`, OR move truncation server-side as an atomic
  // store operation (`HistoryStore.recordAndTruncate(...)`) so the lock
  // requirement collapses into the store's transaction. Grep
  // `TODO(multi-instance)`.
  const sessionLocks = new Map<SessionId, AsyncMutex>();

  const lockFor = (sessionId: SessionId): AsyncMutex => {
    const existing = sessionLocks.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created = createAsyncMutex();
    sessionLocks.set(sessionId, created);
    return created;
  };

  const estimateEntryChars = (entry: HistoryEntry<TMeta>): number => {
    let total = 0;
    for (const m of deriveLLMContext(entry)) total += m.content.length;
    return total;
  };

  // Sort by envelope timestamp so the observable order reflects when each
  // message was produced rather than when the store happened to see it.
  // Injections land immediately while long-running chart_requests only write
  // after the LLM returns, so insertion order lags and reorders real-time
  // activity. Timestamp ordering is a good-enough approximation for the
  // single-process reference engine; the cloud engine will need a monotonic
  // server-side `receivedAt` (tracked in cloud engine improvements).
  const byTimestamp = (
    entries: readonly HistoryEntry<TMeta>[],
  ): HistoryEntry<TMeta>[] =>
    [...entries].sort((a, b) => a.input.timestamp - b.input.timestamp);

  // Omitted caps disable that dimension. truncate's `>= maxEntries` and
  // `> maxChars` comparisons are always false against Infinity, so the
  // limits simply don't fire. Both omitted = truncation becomes a no-op.
  const maxEntries = config.maxEntries ?? Number.POSITIVE_INFINITY;
  const maxChars = config.maxChars ?? Number.POSITIVE_INFINITY;

  const applyTruncation = async (sessionId: SessionId): Promise<void> => {
    const raw = await store.get(sessionId);
    const ordered = byTimestamp(raw);
    const trimmed = truncate(ordered, {
      maxEntries,
      maxChars,
      estimate: estimateEntryChars,
    });
    if (trimmed.length !== ordered.length) {
      await store.replace(sessionId, trimmed);
    }
  };

  return {
    async recordTurn(input, output) {
      const mutex = lockFor(input.sessionId);
      await mutex.run(async () => {
        const raw: HistoryEntry<TMeta> = { kind: 'turn', input, output };
        const transformed = config.transformEntry?.(raw) ?? raw;
        const entry = lockEntryIdentity(raw, transformed);
        const { inserted } = await store.append(input.sessionId, entry);
        // Truncation only needs to run when the store actually grew; a
        // deduped no-op can't push us past maxEntries/maxChars.
        if (inserted) {
          await applyTruncation(input.sessionId);
        }
      });
    },

    async addAssistantMessage(input) {
      // The append itself is lock-free — dedup correctness is owned by
      // HistoryStore.append's atomicity. Truncation, however, must serialize
      // with recordTurn's truncation: both call store.replace, and racing
      // replaces can clobber each other's appends. We acquire the per-session
      // mutex only for the truncation step so injection writes don't queue
      // behind a long-running chart_request, while still preventing the
      // unbounded-growth bug where N back-to-back injections accumulate past
      // maxEntries until the next recordTurn happens to truncate.
      const raw: HistoryEntry<TMeta> = { kind: 'injection', input };
      const transformed = config.transformEntry?.(raw) ?? raw;
      const entry = lockEntryIdentity(raw, transformed);
      const result = await store.append(input.sessionId, entry);
      if (result.inserted) {
        await lockFor(input.sessionId).run(() =>
          applyTruncation(input.sessionId),
        );
      }
      return result;
    },

    async getHistory(sessionId) {
      return byTimestamp(await store.get(sessionId));
    },

    async getLLMContext(sessionId) {
      const entries = byTimestamp(await store.get(sessionId));
      return entries.flatMap((entry) => [...deriveLLMContext(entry)]);
    },

    async clear(sessionId) {
      // Always route through the per-session mutex (creating one on demand
      // for unknown sessions). The previous lockless fast-path raced against
      // a concurrent first recordTurn that would create its own fresh mutex
      // between this map check and the store.clear — interleaved, the turn's
      // append could survive the clear. Symmetric locking removes the race.
      await lockFor(sessionId).run(() => store.clear(sessionId));
      sessionLocks.delete(sessionId);
    },

    async getResponseById(sessionId, messageId) {
      return store.getResponseById(sessionId, messageId);
    },
  };
}

/**
 * Concatenates every `user_intent` UpdateReason on a request into a single
 * string, joined by a space. Internal — used by both the default LLM-context
 * projection (so prior turns appear as user messages to the LLM) and by
 * `Engine.getHistory`'s wire DTO projection (so clients see the same string
 * the LLM saw). Keeping a single helper means the two projections cannot
 * silently drift apart on the join character or filter predicate.
 */
export const extractUserIntent = (reasons: readonly UpdateReason[]): string =>
  reasons
    .filter(
      (r): r is Extract<UpdateReason, { type: 'user_intent' }> =>
        r.type === 'user_intent',
    )
    .map((r) => r.intent)
    .join(' ');

// The engine relies on `kind`, `input.id`, `input.sessionId`, and
// `input.timestamp` for routing, dedup, sorting, and pattern-matching. A
// transformEntry hook can return any shape it wants, so we re-impose those
// fields from the raw entry post-hook. Hooks can still strip or rewrite
// payload fields (rationale, output, metadata, content) — that's their
// documented purpose — but they can't silently corrupt identity.
const lockEntryIdentity = <TMeta>(
  raw: HistoryEntry<TMeta>,
  transformed: HistoryEntry<TMeta>,
): HistoryEntry<TMeta> => {
  if (raw.kind === 'turn') {
    const t =
      transformed.kind === 'turn'
        ? transformed
        : (raw as Extract<HistoryEntry<TMeta>, { kind: 'turn' }>);
    return {
      ...t,
      kind: 'turn',
      input: {
        ...t.input,
        id: raw.input.id,
        sessionId: raw.input.sessionId,
        timestamp: raw.input.timestamp,
      },
    };
  }
  const t =
    transformed.kind === 'injection'
      ? transformed
      : (raw as Extract<HistoryEntry<TMeta>, { kind: 'injection' }>);
  return {
    ...t,
    kind: 'injection',
    input: {
      ...t.input,
      id: raw.input.id,
      sessionId: raw.input.sessionId,
      timestamp: raw.input.timestamp,
    },
  };
};

const defaultDeriveLLMContext = <TMeta>(
  entry: HistoryEntry<TMeta>,
): LLMContextMessage[] => {
  if (entry.kind === 'injection') {
    return [{ role: 'assistant', content: entry.input.content }];
  }
  const messages: LLMContextMessage[] = [];
  const userContent = extractUserIntent(
    entry.input.request.context.updateReasons,
  );
  if (userContent.length > 0) {
    messages.push({ role: 'user', content: userContent });
  }
  messages.push({
    role: 'assistant',
    content: entry.output.response.userMessage,
  });
  return messages;
};
