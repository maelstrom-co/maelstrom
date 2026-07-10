/**
 * Wraps `fn` so that only the most recent call within a trailing `ms` window
 * actually fires — intermediate calls are discarded, not queued. Used to
 * collapse rapid render-settle events into a single grounding push carrying
 * the latest structural snapshot: the model should never see a burst of
 * stale grounding text for a UI state that has already moved on.
 *
 * The returned function carries a `cancel()` so a caller tearing down the
 * session this debounce belongs to can drop a pending trailing call —
 * otherwise it fires on its own timer after teardown and can land as a new
 * session's first grounding push.
 *
 * @example
 * ```ts
 * const push = groundedDebounce((snapshot: UIStructuralSnapshot) => {
 *   adapter.injectGrounding(summarize(snapshot));
 * }, 1000);
 * push.cancel(); // e.g. on session disconnect
 * ```
 */
export function groundedDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel(): void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let latest: A;
  const debounced = (...args: A) => {
    latest = args;
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = undefined;
      fn(...latest);
    }, ms);
  };
  debounced.cancel = () => {
    if (handle) clearTimeout(handle);
    handle = undefined;
  };
  return debounced;
}
