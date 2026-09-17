import type {
  AssistantInjectionMessage,
  ChartRequestMessage,
  ChartResponseOutput,
  MessageId,
  SessionId,
  UpdateReason,
} from '@maelstrom-co/protocol';
import type { PlanningHistoryEntry } from '../planning/contracts.js';
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

/** Frozen planner views derived from the same retained history entry set. */
export interface PlanningHistoryContext {
  /** Accepted structured plans and injections for planner implementations. */
  readonly structured: readonly PlanningHistoryEntry[];
  /** Existing role-tagged context for the conventional LLM planner. */
  readonly conversation: readonly LLMContextMessage[];
}

/** Persistence, retention, and prompt-projection policy for Engine history. */
export interface HistoryConfig<TMeta = unknown> {
  /**
   * Hard cap on per-session entry count. Omit to disable the entry-count
   * cap entirely. The conversational and planning character budgets still
   * apply when configured; omitting all three caps disables truncation.
   */
  readonly maxEntries?: number;
  /**
   * Budget for total characters in retained LLM-context projections. Omit to
   * disable it. With {@link createEngine}, this must be a positive integer and
   * an `assistant_message` whose `content.length` exceeds it is rejected.
   * Truncation retains the newest entry even if its projection alone exceeds
   * the budget. Direct {@link createHistoryManager} calls skip those Engine
   * boundary checks; a non-positive value retains no entries.
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
   * once per entry during truncation cost estimation, so keep the projection
   * cheap and side-effect-free. When omitted, the engine uses its default
   * projection: turns produce a user message (from user_intent reasons) +
   * an assistant message (from the response's userMessage, or a bounded
   * structural summary for a text-free turn); injections produce a single
   * assistant message. Returning an empty array has zero conversational
   * retention cost and does not change the independent planning projection.
   *
   * The `defaults` callback returns the engine's default projection for the
   * same entry, enabling compose-with-default overrides without reimplementing
   * the full projection. Call it from any branch that should fall through to
   * default behavior; ignore it entirely for a full replacement.
   *
   * Override to expose richer stored `metadata` to the LLM, rewrite roles,
   * or merge multiple entries into a single context message.
   */
  readonly deriveLLMContext?: (
    entry: HistoryEntry<TMeta>,
    defaults: () => readonly LLMContextMessage[],
  ) => readonly LLMContextMessage[];
  /** Independent projection and retention policy for planner plan context. */
  readonly planning?: {
    /**
     * Positive integer character budget for deterministic structured-plan
     * serialization, measured only until the budget is exceeded. Omit to
     * disable this budget. An empty projection costs zero. The newest entry
     * remains sticky when oversized; this does not truncate its accepted plan.
     */
    readonly maxChars?: number;
    /**
     * Projects one retained entry into accepted planning context. It is
     * independent from `deriveLLMContext`; use `defaults` to extend the
     * engine projection without rebuilding finalized layout and action data.
     */
    readonly deriveContext?: (
      entry: HistoryEntry<TMeta>,
      defaults: () => readonly PlanningHistoryEntry[],
    ) => readonly PlanningHistoryEntry[];
  };
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
  /** Returns frozen conversational and structured views from one retained read. */
  getPlanningContext(sessionId: SessionId): Promise<PlanningHistoryContext>;
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
  const customDerive = config.deriveLLMContext;
  // Wrap the user hook so each invocation receives a `defaults` thunk that
  // computes the engine's default projection for the same entry on demand.
  // Branches that don't need defaults skip the work; branches that do compose
  // with the default without having to reimplement it.
  const projectEntry: (
    entry: HistoryEntry<TMeta>,
  ) => readonly LLMContextMessage[] = customDerive
    ? (entry) => customDerive(entry, () => defaultDeriveLLMContext(entry))
    : defaultDeriveLLMContext;
  const customPlanningDerive = config.planning?.deriveContext;
  const projectPlanningEntry: (
    entry: HistoryEntry<TMeta>,
  ) => readonly PlanningHistoryEntry[] = customPlanningDerive
    ? (entry) =>
        customPlanningDerive(entry, () => defaultDerivePlanningContext(entry))
    : defaultDerivePlanningContext;
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
    for (const m of projectEntry(entry)) total += m.content.length;
    return total;
  };
  const planningMaxChars = config.planning?.maxChars;
  const estimatePlanningEntryChars = (entry: HistoryEntry<TMeta>): number =>
    stableSerializedLength(
      projectPlanningEntry(entry),
      planningMaxChars ?? Number.POSITIVE_INFINITY,
    );

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
      ...(planningMaxChars !== undefined && {
        additionalBudgets: [
          { maxChars: planningMaxChars, estimate: estimatePlanningEntryChars },
        ],
      }),
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
      return entries.flatMap((entry) => [...projectEntry(entry)]);
    },

    async getPlanningContext(sessionId) {
      const entries = byTimestamp(await store.get(sessionId));
      return freezePlanningContext({
        structured: entries.flatMap((entry) => [
          ...projectPlanningEntry(entry),
        ]),
        conversation: entries.flatMap((entry) => [...projectEntry(entry)]),
      });
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
  const userMessage = entry.output.response.userMessage;
  messages.push({
    role: 'assistant',
    content: userMessage?.trim().length
      ? userMessage
      : `[Accepted structural plan]\n${boundedStructuralSummary(entry)}`,
  });
  return messages;
};

const defaultDerivePlanningContext = <TMeta>(
  entry: HistoryEntry<TMeta>,
): PlanningHistoryEntry[] => {
  if (entry.kind === 'injection') {
    return [
      {
        kind: 'injection',
        id: entry.input.id,
        sessionId: entry.input.sessionId,
        timestamp: entry.input.timestamp,
        content: entry.input.content,
      },
    ];
  }
  const response = entry.output.response;
  return [
    {
      kind: 'turn',
      id: entry.input.id,
      sessionId: entry.input.sessionId,
      timestamp: entry.input.timestamp,
      updateReasons: entry.input.request.context.updateReasons,
      layout: response.layout,
      executionPlan: response.executionPlan,
      ...nonBlankField(response.userMessage, 'userMessage'),
      ...nonBlankField(response.rationale, 'rationale'),
    },
  ];
};

const STRUCTURAL_SUMMARY_MAX_CHARS = 2_000;
const TRUNCATED_SUMMARY_MARKER = '\n[summary truncated]';

function nonBlankField<T extends 'userMessage' | 'rationale'>(
  value: string | undefined,
  key: T,
): { readonly [K in T]?: string } {
  const field: { readonly [K in T]?: string } = {};
  if (value?.trim().length) {
    Object.defineProperty(field, key, {
      value,
      enumerable: true,
    });
  }
  return field;
}

function boundedStructuralSummary(
  entry: Extract<HistoryEntry, { kind: 'turn' }>,
): string {
  return stableSerialize(
    {
      layout: entry.output.response.layout,
      executionPlan: entry.output.response.executionPlan,
    },
    STRUCTURAL_SUMMARY_MAX_CHARS,
  ).text;
}

/**
 * Measures the deterministic planning projection without materializing an
 * unbounded string. Values larger than the configured budget saturate at one
 * character over it, which makes every older entry fail the same budget while
 * retaining the newest oversized entry through truncate's sticky exception.
 */
function stableSerializedLength(value: unknown, maxChars: number): number {
  if (!Number.isFinite(maxChars)) return 0;
  let length = 0;
  const stringLength = (text: string): void => {
    length += 2;
    for (let index = 0; index < text.length && length <= maxChars; index++) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code))
        length += 2;
      else if (code < 32) length += 6;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          length += 2;
          index++;
        } else length += 6;
      } else length += code >= 0xdc00 && code <= 0xdfff ? 6 : 1;
    }
  };
  type Frame =
    | {
        kind: 'container';
        value: object;
        entries: Iterator<[string | undefined, unknown]>;
        first: boolean;
      }
    | { kind: 'value'; value: unknown };
  const pending: Frame[] = [{ kind: 'value', value }];
  const ancestors = new Set<object>();
  function* entries(current: object): Generator<[string | undefined, unknown]> {
    if (Array.isArray(current)) {
      for (const child of current) yield [undefined, child];
    } else {
      for (const key of Object.keys(current))
        yield [key, (current as Record<string, unknown>)[key]];
    }
  }
  try {
    while (pending.length > 0 && length <= maxChars) {
      const frame = pending.pop();
      if (frame === undefined) break;
      if (frame.kind === 'container') {
        const next = frame.entries.next();
        if (next.done) {
          ancestors.delete(frame.value);
          continue;
        }
        if (!frame.first) length++;
        frame.first = false;
        const [key, child] = next.value;
        if (key !== undefined) {
          stringLength(key);
          length++;
        }
        pending.push(frame, { kind: 'value', value: child });
        continue;
      }
      const current = frame.value;
      if (typeof current === 'string') stringLength(current);
      else if (current === null || typeof current !== 'object')
        length += (JSON.stringify(current) ?? 'null').length;
      else {
        if (ancestors.has(current)) return maxChars + 1;
        ancestors.add(current);
        length += 2;
        pending.push({
          kind: 'container',
          value: current,
          entries: entries(current),
          first: true,
        });
      }
    }
  } catch {
    return maxChars + 1;
  }
  return Math.min(length, maxChars + 1);
}

function stableSerialize(
  value: unknown,
  maxChars: number,
): { readonly text: string; readonly length: number } {
  let output = '';
  let truncated = false;
  const append = (part: string): boolean => {
    const remaining = maxChars - output.length;
    if (part.length > remaining) {
      const contentLimit = Math.max(
        0,
        maxChars - TRUNCATED_SUMMARY_MARKER.length,
      );
      output = `${output}${part.slice(0, Math.max(0, remaining))}`.slice(
        0,
        contentLimit,
      );
      truncated = true;
      return false;
    }
    output += part;
    return true;
  };
  const seen = new Set<object>();
  const visit = (current: unknown, depth: number): boolean => {
    if (depth > 32) return append('"[depth exceeded]"');
    if (current === null || typeof current !== 'object') {
      try {
        return append(JSON.stringify(current) ?? 'null');
      } catch {
        return append('"[unserializable]"');
      }
    }
    if (seen.has(current)) return append('"[cycle]"');
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        if (!append('[')) return false;
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0 && !append(',')) return false;
          if (!visit(current[index], depth + 1)) return false;
        }
        return append(']');
      }
      if (!append('{')) return false;
      const record = current as Record<string, unknown>;
      for (const [index, key] of Object.keys(record).sort().entries()) {
        if (index > 0 && !append(',')) return false;
        if (!append(JSON.stringify(key))) return false;
        if (!append(':')) return false;
        if (!visit(record[key], depth + 1)) return false;
      }
      return append('}');
    } catch {
      return append('"[unserializable]"');
    } finally {
      seen.delete(current);
    }
  };
  visit(value, 0);
  const text = truncated ? `${output}${TRUNCATED_SUMMARY_MARKER}` : output;
  return {
    text,
    length: truncated ? maxChars + 1 : output.length,
  };
}

function freezePlanningContext(
  context: PlanningHistoryContext,
): PlanningHistoryContext {
  return freezeValue(cloneValue(context));
}

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  const copy: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value))
    copy[key] = cloneValue(child);
  return copy as T;
}

function freezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  const pending: object[] = [value as object];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || Object.isFrozen(current)) continue;
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') pending.push(child);
    }
    Object.freeze(current);
  }
  return value;
}
