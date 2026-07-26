/**
 * `@maelstrom-co/realtime-vad` — the provider-neutral browser voice-activity
 * detection engine that drives automatic turn-taking for any
 * `RealtimeProviderAdapter`.
 *
 * `createBrowserVad` never acquires a microphone: callers pass a
 * `MediaStream` they already own and never stop, plus `startTurn`, `endTurn`,
 * and `onFailure` callbacks. Reacting to those speech edges — resuming
 * upstream publication, flushing pre-roll, or whatever else a given
 * transport needs — is the caller's responsibility, not this package's.
 * Shipped separately from `@maelstrom-co/realtime` so consumers that don't
 * use automatic turn-taking never pay for `@ricky0123/vad-web` and
 * `onnxruntime-web`; the Node-only asset copier lives behind the `./assets`
 * subpath so it never reaches a browser bundle.
 */
export {
  type BrowserVad,
  createBrowserVad,
  resolveBrowserVadConfig,
} from './browser-vad.js';
export type {
  BrowserVadOptions,
  BrowserVadProviderOptions,
} from './browser-vad.types.js';
