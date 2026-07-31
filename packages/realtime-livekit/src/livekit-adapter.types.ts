import type { RealTimeVADOptions } from '@ricky0123/vad-web';

import type { LiveKitTokenGrant } from './livekit-token.js';

/** VAD tuning that cannot replace adapter-owned lifecycle or asset behavior. */
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
 * Adapter-owned browser VAD configuration. Malformed values degrade a
 * connected adapter to manual mode rather than being clamped or ignored.
 */
export interface LiveKitBrowserVadOptions {
  /**
   * Trusted runtime asset directory. Relative URLs stay same-origin. Absolute
   * URLs must be credential-free HTTPS; protocol-relative URLs, query strings,
   * and fragments are rejected. The package-owned build helper must deploy the
   * matching files separately.
   */
  readonly assetBaseUrl?: string;
  /** Browser-local transport pre-roll in the inclusive 0–500ms range. Defaults to 250ms. */
  readonly preRollMs?: number;
  /** Supported provider tuning; lifecycle, streams, callbacks, and assets remain adapter-owned. */
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
   * Browser VAD policy. Omitted or `true` enables automatic mode with defaults;
   * an object overrides supported settings; `false` selects manual turns without
   * loading VAD or pre-roll worklets. Automatic setup/runtime failures degrade
   * a usable connection to diagnostic manual mode only after upstream audio is
   * paused; LiveKit transport failures reject instead of degrading.
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
