import type { RealTimeVADOptions } from '@ricky0123/vad-web';

import type { LiveKitTokenGrant } from './livekit-token.js';

/**
 * Supported provider tuning: `model`, `positiveSpeechThreshold`,
 * `negativeSpeechThreshold`, `redemptionMs`, `preSpeechPadMs`, `minSpeechMs`,
 * `processorType`, and `workletOptions`. Other provider options cannot replace
 * adapter-owned lifecycle, stream, callback, or asset behavior.
 */
export interface LiveKitBrowserVadProviderOptions {
  /** Silero model generation loaded from the configured asset directory. */
  readonly model?: RealTimeVADOptions['model'];
  /** Per-frame speech probability threshold in the inclusive 0–1 range. */
  readonly positiveSpeechThreshold?: RealTimeVADOptions['positiveSpeechThreshold'];
  /** Per-frame non-speech probability threshold in the inclusive 0–1 range. */
  readonly negativeSpeechThreshold?: RealTimeVADOptions['negativeSpeechThreshold'];
  /** Silence grace period before the provider reports speech end. */
  readonly redemptionMs?: RealTimeVADOptions['redemptionMs'];
  /**
   * Audio prepended to the provider's detected segment. This affects detection
   * output only and does not populate the adapter's transport `preRollMs`.
   */
  readonly preSpeechPadMs?: RealTimeVADOptions['preSpeechPadMs'];
  /** Shorter detected segments become VAD misfires instead of speech turns. */
  readonly minSpeechMs?: RealTimeVADOptions['minSpeechMs'];
  /** Browser audio processor selection used by the VAD runtime. */
  readonly processorType?: RealTimeVADOptions['processorType'];
  /** AudioWorklet construction options; lifecycle callbacks remain adapter-owned. */
  readonly workletOptions?: RealTimeVADOptions['workletOptions'];
}

/**
 * Adapter-owned browser VAD configuration. Invalid configuration and VAD
 * setup, runtime, or callback failures can degrade an otherwise usable
 * connection to manual mode, but only after upstream audio is safely paused.
 * Fatal transport or audio-safety failures tear down the connection instead.
 */
export interface LiveKitBrowserVadOptions {
  /**
   * Trusted VAD runtime asset directory. Defaults to `/vad-web/`. Relative URLs
   * stay same-origin. Absolute URLs must be credential-free HTTPS;
   * protocol-relative URLs, query strings, and fragments are rejected. The
   * package-owned build helper must deploy the matching files separately.
   */
  readonly assetBaseUrl?: string;
  /**
   * Bounded browser-local transport pre-roll, sent once when speech begins.
   * Defaults to 250 ms and accepts 0–500 ms. Provider `preSpeechPadMs` changes
   * the detected segment; it does not populate or replace transport pre-roll.
   */
  readonly preRollMs?: number;
  /**
   * Only the keys declared by {@link LiveKitBrowserVadProviderOptions} are
   * accepted.
   */
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
   * Browser VAD policy. Omitting `vad` means leaving the `vad` property out of
   * the options object passed to `new LiveKitAdapter(...)`. Omission and `true`
   * enable automatic mode with defaults, an object customizes supported
   * settings, and `false` selects manual mode without loading VAD or pre-roll
   * worklets.
   *
   * ```ts
   * new LiveKitAdapter({ mintToken, roomName }); // `vad` omitted
   * new LiveKitAdapter({ mintToken, roomName, vad: true });
   * new LiveKitAdapter({ mintToken, roomName, vad: { preRollMs: 300 } });
   * new LiveKitAdapter({ mintToken, roomName, vad: false });
   * ```
   *
   * If VAD setup, runtime, or a VAD callback fails and upstream audio can be
   * paused safely, the live connection degrades to manual mode. `turnControl` is
   * dynamic and available only while the retained turn mode is `manual`.
   * Failures that prevent a safe audio stop, and LiveKit token, room,
   * publication, required data-channel, or unexpected disconnect failures, are
   * fatal and do not degrade to manual mode.
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
