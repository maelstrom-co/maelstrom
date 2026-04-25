/**
 * A promise-chaining mutex — guarantees that the critical sections submitted
 * via {@link AsyncMutex.run} execute serially and in submission order, even
 * though the caller is free to fire off as many concurrent submissions as it
 * wants.
 *
 * Used by {@link HistoryManager} to serialize `chart_request` processing per
 * session, so read-then-LLM-then-write sequences cannot interleave across
 * concurrent requests on the same session.
 *
 * ---
 *
 * WARNING — single-process reference primitive.
 *
 * This mutex only serializes callers inside the Node/Bun process that created
 * it. Multi-pod / multi-process deployments that serve the same `sessionId`
 * from more than one instance will NOT be protected: each pod has its own
 * in-memory mutex map, so concurrent `chart_request` messages across pods
 * still race — producing stale LLM context, divergent assistant responses,
 * and inconsistent history truncation. The LLM call is 1–5 seconds wide;
 * this is a user-visible bug, not a theoretical one.
 *
 * Production deployments MUST close this gap at a higher layer. Options:
 *   - Session affinity at the load balancer (route all messages for a given
 *     `sessionId` to the same pod)
 *   - Distributed lock service (Redis Redlock, Postgres advisory locks)
 *   - Per-session message queue (partition on `sessionId`)
 *
 * Tracked in the company-internal "Cloud Engine Improvements" doc under
 * §"Cross-process session serialization".
 */
export interface AsyncMutex {
  run<T>(critical: () => Promise<T>): Promise<T>;
}

export function createAsyncMutex(): AsyncMutex {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    async run<T>(critical: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release!: () => void;
      // Installing our own barrier before we await `previous` means the NEXT
      // caller to read `tail` sees an unresolved promise and queues behind us —
      // even if `previous` had already resolved.
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        try {
          await previous;
        } catch {
          // Swallow — one caller's failure must not stall the queue.
        }
        return await critical();
      } finally {
        release();
      }
    },
  };
}
