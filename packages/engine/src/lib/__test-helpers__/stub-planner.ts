import { err, ok } from '@maelstrom-co/protocol';

import type { EngineError } from '../errors.js';
import type { PlannerCandidate } from '../planner/candidate.js';
import type { Planner } from '../planner/stage.js';
import type { Deferred } from './defer.js';
import { defer } from './defer.js';

/**
 * A {@link Planner} that returns each of `candidates` in order, one per
 * call, wrapped `ok`. Throws a descriptive error if it is called more times
 * than it was scripted for, so an unexpectedly extra planner invocation
 * fails loudly instead of silently returning `undefined`.
 */
export function scriptedPlanner(
  candidates: readonly PlannerCandidate[],
): Planner {
  let index = 0;
  return async () => {
    if (index >= candidates.length) {
      throw new Error(
        `scriptedPlanner exhausted after ${candidates.length} candidate(s); ` +
          'the planner was called more times than the test scripted',
      );
    }
    const candidate = candidates[index];
    index += 1;
    return ok(candidate as PlannerCandidate);
  };
}

/** A {@link Planner} paired with a signal for when it has been entered. */
export interface BlockingPlanner {
  /** Parks on `gate` until it resolves, then resolves `Ok` with its value. */
  readonly planner: Planner;
  /**
   * Resolves once the planner has been called and is parked on the gate —
   * lets a test wait for the call deterministically instead of guessing a
   * microtask count.
   */
  readonly entered: Promise<void>;
}

/**
 * Builds a {@link Planner} that parks until `gate` resolves (or the request
 * signal aborts), for tests that need to observe a planner mid-flight —
 * for example to issue a concurrent duplicate request while the first is
 * still in progress.
 */
export function blockingPlanner(gate: Deferred<PlannerCandidate>): BlockingPlanner {
  const parked = defer<void>();
  const planner: Planner = (_input, ctx) => {
    parked.resolve();
    if (ctx.signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reject(new DOMException('Aborted', 'AbortError'));
      };
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
      gate.promise.then(
        (candidate) => {
          ctx.signal?.removeEventListener('abort', onAbort);
          resolve(ok(candidate));
        },
        (reason: unknown) => {
          ctx.signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      );
    });
  };
  return { planner, entered: parked.promise };
}

/** A {@link Planner} that resolves `Err(error)` on every call. */
export function failingPlanner(error: EngineError): Planner {
  return async () => err(error);
}

/** A {@link Planner} that throws `error` on every call. */
export function throwingPlanner(error: unknown): Planner {
  return async () => {
    throw error;
  };
}
