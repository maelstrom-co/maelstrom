import { MaelstromError } from '@maelstrom-co/protocol';

/**
 * Discriminator for `@maelstrom-co/voice` peer-dependency failures surfaced
 * via {@link VoiceDependencyError}.
 *
 * These codes describe the state of the peer dependency itself, not a
 * session or wire failure. Both fire from the same place — the async
 * dynamic-import probe inside `useVoice()` — so they reach consumers via
 * `onError`, not React error boundaries.
 */
export type VoiceDependencyCode =
  /**
   * `@maelstrom-co/voice` is not installed (the bundler / module loader
   * reported a missing-module error, e.g. `ERR_MODULE_NOT_FOUND`).
   * Remediation: install the peer dependency.
   */
  | 'DEPENDENCY_MISSING'
  /**
   * `@maelstrom-co/voice` is installed but unusable — either it threw during
   * module evaluation (transitive dependency failure, runtime init error)
   * or it loaded without exporting `VoiceSession`. Inspect `cause` for the
   * underlying error. Often signals a version mismatch, a broken install,
   * or a transitive dependency failure (e.g. `onnxruntime-web` init).
   */
  | 'DEPENDENCY_BROKEN';

/**
 * Typed error surfaced when the `@maelstrom-co/voice` peer dependency cannot
 * be loaded by `useVoice()`.
 *
 * Catch via `instanceof MaelstromError` (broad) or `instanceof
 * VoiceDependencyError` (specific). Reached via `onError` on the first owner
 * call to `useVoice({ ... })` — the failure is reported from an async
 * `.then(...)` chain, so React error boundaries do not catch it directly.
 * Store the error in component state from `onError` and re-throw during
 * render if you want a boundary to handle it.
 */
export class VoiceDependencyError extends MaelstromError {
  constructor(code: VoiceDependencyCode, message: string, cause?: unknown) {
    super(code, message, cause);
    this.name = 'VoiceDependencyError';
  }
}

export const VOICE_PEER_NOT_INSTALLED_MSG =
  '[Maelstrom] @maelstrom-co/voice is not installed. Install it as a peer dependency to enable voice.';

export const VOICE_PEER_LOAD_FAILED_MSG =
  '[Maelstrom] @maelstrom-co/voice failed to load. See cause for details.';

export const VOICE_SESSION_EXPORT_MISSING_MSG =
  '[Maelstrom] @maelstrom-co/voice loaded but did not export VoiceSession.';
