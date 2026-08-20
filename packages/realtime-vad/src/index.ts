/**
 * `@maelstrom-co/realtime-vad` — the provider-neutral browser voice-activity
 * detection engine and local-audio publication buffer for automatic
 * turn-taking with any transport.
 *
 * `createBrowserVad` never acquires a microphone: callers pass a
 * `MediaStream` they already own and never stop, plus `startTurn`, `endTurn`,
 * and `onFailure` callbacks. Reacting to those speech edges — resuming
 * upstream publication, flushing pre-roll, or whatever else a given
 * transport needs — is the caller's responsibility, not this package's.
 * Shipped separately from `@maelstrom-co/realtime` so consumers that don't
 * use browser VAD never pay for `@ricky0123/vad-web` and `onnxruntime-web`;
 * `createLocalAudioPreRoll` separately creates a generated publication track
 * that silently retains a bounded local tail while closed. The Node-only asset
 * copier lives behind the `./assets` subpath so it never reaches a browser
 * bundle.
 */
export {
  type BrowserVad,
  type CreateBrowserVadOptions,
  createBrowserVad,
} from './browser-vad.js';
export {
  type BrowserVadOptions,
  type BrowserVadProviderOptions,
  type ResolvedBrowserVadConfig,
  resolveBrowserVadConfig,
} from './browser-vad-config.js';
export {
  createLocalAudioPreRoll,
  type LocalAudioPreRoll,
} from './local-audio-pre-roll.js';
