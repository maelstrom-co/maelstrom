/**
 * A promise-chaining mutex — guarantees that the critical sections submitted
 * via {@link AsyncMutex.run} execute serially and in submission order, even
 * though the caller is free to fire off as many concurrent submissions as it
 * wants.
 *
 * Used by {@link HistoryManager} to serialize the read-modify-write pass
 * inside `recordTurn` (`store.append` + truncation), the truncation step
 * inside `addAssistantMessage`, and `clear`. The LLM call itself is NOT
 * protected — concurrent `chart_request`s on the same session race their
 * LLM reads/calls; the mutex only prevents racing truncations from
 * clobbering each other's appends. Identical `(sessionId, messageId)`
 * duplicates are coalesced separately by the in-flight Map in
 * `chart-request-dedup`, not by this mutex.
 *
 * ---
 *
 * TODO(multi-instance): single-process reference primitive — see WARNING below.
 *
 * WARNING — single-process reference primitive.
 *
 * This mutex only serializes callers inside the Node/Bun process that created
 * it. Multi-pod / multi-process deployments that serve the same `sessionId`
 * from more than one instance will NOT be protected: each pod has its own
 * in-memory mutex map, so concurrent `recordTurn` / `addAssistantMessage`
 * truncations across pods can clobber each other's appends, resurrecting
 * evicted entries or duplicating retained ones. (Stale LLM context and
 * divergent assistant responses are a separate concern this mutex does NOT
 * address even within a single process — the LLM call runs outside the
 * critical section by design. Closing that gap requires session-level
 * serialization at a higher layer; see options below.)
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
