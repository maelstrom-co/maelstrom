const warnedOnce = new Set<string>();

interface WarnOnceOptions {
  enabled?: boolean;
}

/**
 * Emits a console warning for the first enabled call for a key in this loaded
 * module instance. Later enabled calls with the same key are no-ops, regardless
 * of their message. Disabled calls neither emit a warning nor record the key.
 * State is not shared across processes, realms, or separately loaded copies.
 */
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

/**
 * Clears warning keys recorded by this loaded module instance.
 *
 * An empty-state reset is a no-op. After a reset, the next enabled
 * {@link warnOnce} call for a previously recorded key emits again. The reset is
 * local to this package copy in the current process and does not affect other
 * processes, realms, or separately loaded copies. Application code receives
 * neither warning-state function from the package root; tests can access only
 * this reset through `@maelstrom-co/react/_testing`.
 */
export function resetWarnings() {
  warnedOnce.clear();
}
