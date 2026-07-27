const warnedOnce = new Set<string>();

interface WarnOnceOptions {
  enabled?: boolean;
}

/** Log a warning only once per key (across the lifetime of the module) */
export function warnOnce(
  key: string,
  message: string,
  options?: WarnOnceOptions,
) {
  if ((options?.enabled ?? true) && !warnedOnce.has(key)) {
    warnedOnce.add(key);
    console.warn(message);
  }
}

/** Clear all suppressed warning keys. Intended for test cleanup. */
export function resetWarnings() {
  warnedOnce.clear();
}
