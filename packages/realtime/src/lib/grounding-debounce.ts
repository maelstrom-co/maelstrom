/**
 * Wraps `fn` so that only the most recent call within a trailing `ms` window
 * actually fires — intermediate calls are discarded, not queued. Used to
 * collapse rapid render-settle events into a single grounding push carrying
 * the latest structural snapshot: the model should never see a burst of
 * stale grounding text for a UI state that has already moved on.
 *
 * @example
 * ```ts
 * const push = groundedDebounce((snapshot: UiStructuralSnapshot) => {
 *   adapter.injectGrounding(summarize(snapshot));
 * }, 1000);
 * ```
 */
export function groundedDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let latest: A;
  return (...args: A) => {
    latest = args;
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = undefined;
      fn(...latest);
    }, ms);
  };
}
