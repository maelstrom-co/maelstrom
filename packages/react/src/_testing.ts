/** Test-only utilities for `@maelstrom-co/react`. */

/**
 * Clears warning de-duplication state held by this loaded module instance.
 * Calling it with no recorded warnings is a no-op. After a reset, a subsequent
 * enabled warning for a previously recorded key can be emitted again.
 *
 * The state is local to the loaded package copy in the current process; this
 * does not reset other processes, realms, or separately loaded copies. Unlike
 * the application-facing package root, the `_testing` subpath intentionally
 * exposes this reset utility and does not expose the warning helper itself.
 */
export { resetWarnings } from './lib/warn-once.js';
