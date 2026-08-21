/** Timing and logging options for coalescing non-intent Chart updates. */
export interface UpdateCoordinatorOptions {
  /** Quiet period before scheduled updates flush. Defaults to 300 milliseconds. */
  debounceDelayMs?: number;
  /** Maximum age before a pending update flushes. Defaults to 1,000 milliseconds. */
  maxWaitMs?: number;
  /** Enables diagnostic logging. Defaults to `false`. */
  debug?: boolean;
}
