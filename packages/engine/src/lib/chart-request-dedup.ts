import type {
  ChartRequestMessage,
  ChartResponseOutput,
  MessageId,
  Result,
  SessionId,
} from '@maelstrom-co/protocol';
import { err, isOk, ok } from '@maelstrom-co/protocol';

import { assertNever } from './assert-never.js';
import type { EngineError } from './errors.js';
import { cancellationError, historyError } from './errors.js';
import type { HistoryManager } from './history/history-manager.js';
import type { GetResponseByIdResult } from './history/history-store.js';
import type { Logger } from './logger.js';

type RunChartRequest = (
  message: ChartRequestMessage,
  signal?: AbortSignal,
) => Promise<Result<ChartResponseOutput, EngineError>>;

/**
 * Idempotent wrapper around the underlying chart_request runner. See
 * {@link createChartRequestDedup} for routing semantics.
 */
export interface ChartRequestDedup {
  handle(
    message: ChartRequestMessage,
    signal?: AbortSignal,
  ): Promise<Result<ChartResponseOutput, EngineError>>;
}

/**
 * Minimal-surface DI typing — the dedup module only consumes `getResponseById`
 * (cache lookup) and `recordTurn` (advisory write). Typing the dependency as
 * `Pick<HistoryManager, ...>` keeps the production contract honest (this
 * module never reaches for `getLLMContext` / `addAssistantMessage` / `clear`)
 * and lets tests pass a lightweight stub without `as unknown as` casts.
 */
export type DedupHistoryBinding = Pick<
  HistoryManager,
  'getResponseById' | 'recordTurn'
>;

export interface ChartRequestDedupDeps {
  /**
   * Result-typed under engine contract — must not reject. A contract
   * violation is absorbed downstream as `historyError.leaderPipeline` to
   * prevent follower hangs.
   */
  readonly runChartRequest: RunChartRequest;
  /**
   * Optional history binding. When `undefined`, `handle` degenerates to a
   * single `runChartRequest` call — dedup is impossible without a store
   * to replay from. When defined, the same instance is used for both
   * cache lookup (`getResponseById`) and the advisory `recordTurn` write
   * after a successful run.
   */
  readonly history: DedupHistoryBinding | undefined;
  readonly logger: Logger;
}

/**
 * Wraps `runChartRequest` with the engine's idempotency machinery:
 *
 * 1. cache lookup (`history.getResponseById`) — replays a prior response
 *    without re-invoking the LLM.
 * 2. in-flight coalescing (process-local Map keyed by `sessionId::messageId`)
 *    — collapses concurrent duplicates onto a single LLM call.
 * 3. leader execution + advisory `recordTurn` + identity-guarded cleanup —
 *    cleanup runs AFTER recordTurn settles so a follower arriving in the
 *    post-LLM / pre-recordTurn window still hits the in-flight entry
 *    instead of starting a duplicate LLM call.
 *
 * Engine-instance-scoped: multi-engine deployments do not coalesce dedup
 * state across instances.
 *
 * **Cancellation.** A follower (second concurrent caller) that aborts its
 * own signal resolves only its own await with `Err(CancellationError)`;
 * the leader continues. If the leader's signal aborts, the leader resolves
 * with `Err(CancellationError)` (Result-typed; never rejects under
 * contract), and any followers awaiting the shared leader observe that
 * same `Err` value via the shared promise.
 */
export function createChartRequestDedup(
  deps: ChartRequestDedupDeps,
): ChartRequestDedup {
  const { runChartRequest, history, logger } = deps;

  const runAndRecord = async (
    message: ChartRequestMessage,
    signal?: AbortSignal,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    const result = await runChartRequest(message, signal);
    if (isOk(result) && history !== undefined) {
      // Advisory write: the user already has their response, so a
      // history failure must not retroactively fail the turn.
      try {
        await history.recordTurn(message, result.value);
      } catch (error) {
        logger.error('Failed to record turn', error, {
          op: 'record_turn',
          messageId: message.id,
          sessionId: message.sessionId,
        });
      }
    }
    return result;
  };

  type InflightKey = `${SessionId}::${MessageId}`;
  // TODO(multi-instance): in-flight coalescing is process-local.
  // Failure mode: two engine instances handling the same `(sessionId,
  // messageId)` concurrently each spin up their own leader and each charge
  // the LLM. The shared HistoryStore's `getResponseById` rescues sequential
  // duplicates after the leader settles, but the concurrent window
  // double-spends — the worse the latency, the wider the window.
  // Substrate: a distributed lease keyed by `${sessionId}::${messageId}`
  // (Redis SETNX with TTL + leadership renewal, or DB row lock with NOWAIT)
  // that lets followers on other instances await the leader's eventual
  // store write instead of starting their own. Grep `TODO(multi-instance)`.
  const inflight = new Map<
    InflightKey,
    Promise<Result<ChartResponseOutput, EngineError>>
  >();
  const inflightKey = (
    sessionId: SessionId,
    messageId: MessageId,
  ): InflightKey => `${sessionId}::${messageId}`;

  // Followers race the shared leader promise against their own AbortSignal.
  // A follower-side abort resolves only that follower's await with
  // CancellationError; the leader's LLM call continues. If the leader's
  // signal aborts, the leader resolves with Err(CancellationError) (Result-
  // typed; never rejects under engine contract) and followers observe that
  // same Err via the shared promise's resolved value.
  const awaitWithSignal = (
    leaderPromise: Promise<Result<ChartResponseOutput, EngineError>>,
    signal: AbortSignal | undefined,
    sessionId: SessionId,
    messageId: MessageId,
  ): Promise<Result<ChartResponseOutput, EngineError>> => {
    if (signal === undefined) {
      return leaderPromise;
    }
    if (signal.aborted) {
      return Promise.resolve(
        err(cancellationError('aborted by caller', signal.reason)),
      );
    }
    return new Promise((resolve) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        resolve(err(cancellationError('aborted by caller', signal.reason)));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      leaderPromise.then(
        (r) => {
          signal.removeEventListener('abort', onAbort);
          resolve(r);
        },
        // Defensive catch-all: leaderPromise is Result-typed and should
        // never reject under contract. If it does (an unguarded throw
        // deeper in the pipeline escapes the per-stage try/catch), we'd
        // otherwise hang every follower forever. Surface as a
        // `leader_pipeline` HistoryError so the follower sees an Err shape
        // and the operator log lets them grep by tag.
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          logger.error('Leader promise rejected unexpectedly', error, {
            op: 'leader_pipeline',
            sessionId,
            messageId,
          });
          resolve(
            err(historyError.leaderPipeline('leader pipeline threw', error)),
          );
        },
      );
    });
  };

  return {
    async handle(message, signal) {
      if (history === undefined) {
        return runAndRecord(message, signal);
      }
      // Advisory read: a failed cache lookup must not retroactively fail
      // the turn. The catch collapses a throw into a `miss` so the consumer
      // keeps a single discriminated-union switch with no nullable layer.
      let lookup: GetResponseByIdResult;
      try {
        lookup = await history.getResponseById(message.sessionId, message.id);
      } catch (error) {
        logger.error('Failed to look up cached response', error, {
          op: 'get_response_by_id',
          messageId: message.id,
          sessionId: message.sessionId,
        });
        lookup = { kind: 'miss' };
      }
      switch (lookup.kind) {
        case 'hit':
          return ok(lookup.output);
        case 'kind-mismatch':
          // The id slot is occupied by a non-`turn` entry — treated as a
          // miss for replay (fall through to the fresh LLM path), but
          // surfaced separately so a real `messageId` reuse across kinds
          // is greppable in operator logs. `slotKind` carries the actual
          // stored kind so a future third entry kind doesn't misattribute
          // the warning. Ownership belongs to the consumer (the store no
          // longer emits this warning).
          logger.warn(
            'getResponseById: chart_request id reuses a non-turn slot — running fresh',
            {
              op: 'get_response_by_id',
              outcome: 'kind-mismatch',
              messageId: message.id,
              sessionId: message.sessionId,
              slotKind: lookup.slotKind,
            },
          );
          break;
        case 'miss':
          break;
        default:
          // Compile-time exhaustiveness — fails to compile if
          // GetResponseByIdResult grows a fourth arm without a case here.
          // Mirrors engine.ts's switch on EngineMessage variants.
          return assertNever(lookup, 'chart-request-dedup.handle');
      }
      const key = inflightKey(message.sessionId, message.id);
      const existing = inflight.get(key);
      if (existing !== undefined) {
        return awaitWithSignal(existing, signal, message.sessionId, message.id);
      }
      const leader = runAndRecord(message, signal);
      inflight.set(key, leader);
      // Two cleanup handlers (not `.finally`) so that an unguarded pipeline
      // throw — which would make `leader` reject rather than resolve to
      // `Err` — is absorbed here: `.then(cleanup, cleanup)` returns a
      // resolved promise either way, while `.finally(cleanup)` would
      // propagate the rejection and emit an unhandledRejection off the
      // `void`-discarded handle. The caller's own `await leader` still
      // surfaces the rejection if one occurs.
      //
      // Identity-guarded delete: only evict the slot if it still holds
      // *this* leader's promise. The race is impossible today (no await
      // between the inflight.get / inflight.set above), but a future
      // refactor that introduces one — or restructures registration —
      // could otherwise have this cleanup evict a successor's entry.
      const cleanup = () => {
        if (inflight.get(key) === leader) {
          inflight.delete(key);
        }
      };
      void leader.then(cleanup, cleanup);
      return leader;
    },
  };
}
