import type { RealTimeVADOptions } from '@ricky0123/vad-web';

import type { LiveKitTokenGrant } from './livekit-token.js';

/**
 * Detection tuning passed through to the VAD provider.
 *
 * This is an allowlist, not a partial of the provider's own options: a key that
 * does not appear here is rejected rather than forwarded. Streams, callbacks,
 * lifecycle, asset paths, audio contexts, ONNX Runtime configuration, and start
 * policy stay adapter-owned, because the adapter's guarantee that no microphone
 * media reaches the transport while idle depends on owning all of them.
 *
 * Tuning trades two failures against each other. Stricter thresholds cut false
 * barge-ins and start missing quiet speech; longer silence handling preserves
 * natural pauses and delays the end of every turn. Tune against representative
 * speakers, microphones, browsers, playback volume, and background noise.
 *
 * @example Hold a turn open through longer pauses, in a noisy room
 * ```ts
 * const providerOptions = {
 *   model: 'v5',
 *   positiveSpeechThreshold: 0.8,
 *   redemptionMs: 900,
 *   minSpeechMs: 250,
 * } satisfies LiveKitBrowserVadProviderOptions;
 * ```
 */
export interface LiveKitBrowserVadProviderOptions {
  /** Silero generation to load: `'v5'` or `'legacy'`. Anything else is rejected. */
  readonly model?: RealTimeVADOptions['model'];
  /** Confidence required to treat a frame as speech, from 0 through 1. */
  readonly positiveSpeechThreshold?: RealTimeVADOptions['positiveSpeechThreshold'];
  /** Confidence at which a frame stops counting as speech, from 0 through 1. */
  readonly negativeSpeechThreshold?: RealTimeVADOptions['negativeSpeechThreshold'];
  /**
   * Silence a turn survives before the provider reports speech end, in
   * milliseconds. Non-negative and finite. Raising it keeps a speaker's pauses
   * inside one turn at the cost of ending every turn later.
   */
  readonly redemptionMs?: RealTimeVADOptions['redemptionMs'];
  /**
   * Audio prepended to the provider's detected segment, in milliseconds.
   * Non-negative and finite.
   *
   * This changes what the detector considers and nothing else. It does not
   * populate transport pre-roll: the audio actually sent to the worker at
   * speech start is {@link LiveKitBrowserVadOptions.preRollMs}. Setting this
   * expecting to fix a clipped first word will not fix it.
   */
  readonly preSpeechPadMs?: RealTimeVADOptions['preSpeechPadMs'];
  /**
   * Shortest segment treated as real speech, in milliseconds. Non-negative and
   * finite. A shorter crossing is a misfire, which cancels its transport turn
   * without committing an empty turn to speech recognition.
   */
  readonly minSpeechMs?: RealTimeVADOptions['minSpeechMs'];
  /** Audio processor strategy: `'AudioWorklet'`, `'ScriptProcessor'`, or `'auto'`. */
  readonly processorType?: RealTimeVADOptions['processorType'];
  /** AudioWorklet construction options; lifecycle callbacks remain adapter-owned. */
  readonly workletOptions?: RealTimeVADOptions['workletOptions'];
}

/**
 * Adapter-owned browser VAD configuration.
 *
 * A malformed value is rejected rather than clamped or ignored. On a connected
 * adapter that rejection degrades the session to manual mode, and only after
 * upstream audio is paused — never by leaving an enabled microphone published
 * under a detector that failed to start.
 *
 * @example Serve the assets from a path of your own and hold the turn open longer
 * ```ts
 * new LiveKitAdapter({
 *   roomName,
 *   mintToken,
 *   vad: {
 *     assetBaseUrl: '/static/vad/',
 *     preRollMs: 400,
 *     providerOptions: { redemptionMs: 900 },
 *   },
 * });
 * ```
 */
export interface LiveKitBrowserVadOptions {
  /**
   * Trusted directory holding the complete VAD and ONNX Runtime asset set.
   * Defaults to `/vad-web/`, which is a URL and not a promise that files exist
   * there: deploy them with the package's `./vad-assets` helper or its
   * `maelstrom-livekit-assets` binary, whose output matches this package's
   * pinned VAD and ONNX Runtime versions.
   *
   * Relative URLs stay same-origin. Absolute URLs must be credential-free
   * HTTPS; protocol-relative URLs, query strings, and fragments are rejected.
   * The browser executes worklet, JavaScript, and WebAssembly files from this
   * directory, so treat it as trusted executable infrastructure and never
   * derive it from user input.
   */
  readonly assetBaseUrl?: string;
  /**
   * Browser-local audio retained and sent once at speech start, in
   * milliseconds. Defaults to 250, and accepts a finite number from 0 through
   * 500.
   *
   * A detector needs frames before it can decide speech began, so opening the
   * transport only at that decision clips the first consonant. This buffer is
   * what covers the gap. More of it protects word beginnings and admits more
   * audio from before the accepted boundary, so raise it only after
   * reproducing clipping on a supported browser.
   */
  readonly preRollMs?: number;
  /** Detection tuning. Only the keys declared on the interface are accepted. */
  readonly providerOptions?: LiveKitBrowserVadProviderOptions;
}

/** Options for constructing a {@link LiveKitAdapter}. */
export interface LiveKitAdapterOptions {
  /**
   * Mints a LiveKit grant for `roomName`. Injected (like `OpenAIAdapter`'s
   * `mintToken`) so this browser package stays free of any server-framework
   * coupling — the app owns how the grant is fetched (a TanStack Start server
   * fn, a plain `fetch`, …). Wrap `mintLiveKitToken` from
   * `@maelstrom-co/realtime-livekit-server`.
   */
  readonly mintToken: (roomName: string) => Promise<LiveKitTokenGrant>;
  /**
   * Room the browser joins and the worker is dispatched to. Any unique string
   * works — the worker auto-dispatches to whatever room it is assigned. Use a
   * stable per-session name so a reconnect rejoins the same room.
   */
  readonly roomName: string;
  /**
   * Browser VAD policy. Detection is on unless you turn it off, so a session
   * that never sets this detects turns by itself and exposes no `turnControl`.
   *
   * Only `false` selects manual mode outright, and it is the one form that
   * loads no VAD or pre-roll worklets and fetches no assets. A hold-to-talk
   * button therefore renders in exactly two situations: that setting, or a
   * degradation from a detector that failed.
   *
   * Degrading is conditional on safety, not on the failure being minor. If VAD
   * setup, its runtime, or one of its callbacks fails and upstream audio can
   * still be paused, the live session drops to manual mode and `turnControl`
   * appears. If audio cannot be stopped safely — or the failure is LiveKit
   * token minting, room connection, track publication, a required data
   * channel, or an unexpected disconnect — the session fails instead. Manual
   * mode is never advertised on a connection that cannot hold the upstream
   * invariant.
   *
   * @example Each accepted form
   * ```ts
   * new LiveKitAdapter({ mintToken, roomName }); // automatic, defaults
   * new LiveKitAdapter({ mintToken, roomName, vad: true }); // the same
   * new LiveKitAdapter({ mintToken, roomName, vad: { preRollMs: 300 } });
   * new LiveKitAdapter({ mintToken, roomName, vad: false }); // manual turns
   * ```
   */
  readonly vad?: boolean | LiveKitBrowserVadOptions;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
  /**
   * How long (ms) to wait in `thinking` after `endTurn` before assuming the
   * turn was empty (an accidental tap with no speech) and collapsing back to
   * `connected`. With no server-side VAD, an empty turn produces no worker
   * response, so without this the UI would wedge in `thinking` forever. Any
   * real activity (a transcript, a TTS signal, a barge-in, disconnect) cancels
   * the fallback. Defaults to 10000; set `0` to disable it (e.g. in tests).
   */
  readonly thinkingFallbackMs?: number;
}
