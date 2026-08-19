/** Timing and logging options for coalescing non-intent Chart updates. */
export interface UpdateCoordinatorOptions {
  /** Quiet period before scheduled updates flush. */
  debounceDelayMs?: number;
  /** Maximum time the oldest scheduled update may wait before flushing. */
  maxWaitMs?: number;
  /** Enables diagnostic logging. Defaults to `false`. */
  debug?: boolean;
}
