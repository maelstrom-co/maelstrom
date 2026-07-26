import type { RealTimeVADOptions } from '@ricky0123/vad-web';

/**
 * Detection tuning passed through to the VAD provider.
 *
 * This is an allowlist, not a partial of the provider's options. Streams,
 * callbacks, lifecycle, asset paths, audio contexts, ONNX Runtime
 * configuration, and start policy stay adapter-owned.
 *
 * Stricter thresholds cut false starts and begin missing quiet speech. Longer
 * silence handling preserves natural pauses and delays the end of every turn.
 * Tune against representative speakers, microphones, browsers, playback
 * volume, and background noise.
 */
export interface BrowserVadProviderOptions {
  /** Silero generation to load: `'v5'` or `'legacy'`. */
  readonly model?: RealTimeVADOptions['model'];
  /** Confidence required to treat a frame as speech, from 0 through 1. */
  readonly positiveSpeechThreshold?: RealTimeVADOptions['positiveSpeechThreshold'];
  /** Confidence at which a frame stops counting as speech, from 0 through 1. */
  readonly negativeSpeechThreshold?: RealTimeVADOptions['negativeSpeechThreshold'];
  /** Silence a turn survives before speech end, in non-negative milliseconds. */
  readonly redemptionMs?: RealTimeVADOptions['redemptionMs'];
  /**
   * Audio prepended to the provider's detected segment, in milliseconds. This
   * affects detection only and does not populate transport `preRollMs`.
   */
  readonly preSpeechPadMs?: RealTimeVADOptions['preSpeechPadMs'];
  /** Shortest segment treated as speech, in non-negative milliseconds. */
  readonly minSpeechMs?: RealTimeVADOptions['minSpeechMs'];
  /** Audio processor strategy: `'AudioWorklet'`, `'ScriptProcessor'`, or `'auto'`. */
  readonly processorType?: RealTimeVADOptions['processorType'];
  /** AudioWorklet construction options; lifecycle callbacks remain adapter-owned. */
  readonly workletOptions?: RealTimeVADOptions['workletOptions'];
}

/**
 * Adapter-owned browser VAD configuration.
 *
 * A malformed value is rejected rather than clamped or ignored. The adapter
 * decides whether that failure can degrade safely to manual mode.
 */
export interface BrowserVadOptions {
  /**
   * Trusted directory holding the complete VAD and ONNX Runtime asset set.
   * Defaults to `/vad-web/`. Deploy matching files with the package's asset
   * helper or `maelstrom-vad-assets` binary.
   *
   * Relative URLs stay same-origin. Absolute URLs must be credential-free
   * HTTPS. Protocol-relative URLs, query strings, and fragments are rejected.
   */
  readonly assetBaseUrl?: string;
  /** Browser-local transport pre-roll from 0 through 500ms. Defaults to 250ms. */
  readonly preRollMs?: number;
  /** Supported provider tuning; lifecycle, streams, callbacks, and assets remain adapter-owned. */
  readonly providerOptions?: BrowserVadProviderOptions;
}
