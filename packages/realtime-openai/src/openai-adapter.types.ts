import type {
  OpenAIBuiltInVoice,
  OpenAITokenGrant,
} from '@maelstrom-co/realtime-protocol/openai';

/** Arguments passed to an injected greeting synthesizer. */
export interface SynthesizeGreetingArgs {
  /** Exact greeting text — must not be altered by the synthesizer. */
  readonly text: string;
  /** Configured built-in voice (same value as Realtime session output). */
  readonly voice: OpenAIBuiltInVoice;
  /** Signals that pending synthesis must stop promptly when the greeting or voice session stops. */
  readonly signal: AbortSignal;
}

/**
 * Transport-only greeting synthesizer. Returns WAV bytes; must not play audio
 * or rewrite text. Playback is owned by the adapter's internal Web Audio player.
 */
export type SynthesizeGreeting = (
  args: SynthesizeGreetingArgs,
) => Promise<ArrayBuffer>;

/** Options for constructing an {@link OpenAIAdapter}. */
export interface OpenAIAdapterOptions {
  /**
   * Mints the ephemeral OpenAI realtime client secret this adapter connects
   * with. Called once per `connect()`. The token handshake is assigned to
   * the adapter — `RealtimeSession` never sees a credential.
   */
  readonly mintToken: () => Promise<OpenAITokenGrant>;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
  /**
   * Input-audio transcription configuration for the realtime session.
   *
   * Omitted (the default): transcription is enabled with the built-in model.
   * An object: transcription is enabled with `model` (or the built-in default
   * when `model` is omitted). `false`: transcription is disabled and no
   * transcription config is sent in `session.update`.
   */
  readonly transcription?: false | { readonly model?: string };
  /**
   * OpenAI server-VAD tuning and barge-in policy.
   *
   * The threshold defaults to `0.5` and must be a finite number in `[0, 1]`.
   * Barge-in defaults to `immediate`, which preserves OpenAI-managed response
   * creation and interruption. `transcript-confirmed` disables both provider
   * flags so the adapter can interrupt on the first non-whitespace provisional
   * transcription delta and create a response only after the same committed
   * item has a non-whitespace completed transcript. Delta arrival latency is
   * nondeterministic, and non-whitespace transcription does not prove that the
   * sound came from a human speaker.
   *
   * This configures OpenAI's provider-side VAD only. LiveKit owns browser VAD,
   * microphone gating, and turn boundaries through `LiveKitAdapter`'s separate
   * `vad` option.
   *
   * `transcript-confirmed` requires input transcription. Combining it with
   * `transcription: false` throws a synchronous `TypeError` from the constructor
   * before token minting, microphone capture, peer creation, or connection.
   */
  readonly serverVad?: {
    /** Finite OpenAI server-VAD activation threshold in `[0, 1]` (default `0.5`). */
    readonly threshold?: number;
    /**
     * `immediate` (default) derives `create_response: true` and
     * `interrupt_response: true`. `transcript-confirmed` derives both as false
     * and requires input transcription.
     */
    readonly bargeInMode?: 'immediate' | 'transcript-confirmed';
  };
  /**
   * Built-in Realtime/TTS output voice. Defaults to `marin`. Applied to the
   * initial `session.update` audio.output and passed to
   * {@link synthesizeGreeting}.
   */
  readonly voice?: OpenAIBuiltInVoice;
  /**
   * Fetches WAV bytes for the exact greeting text. Optional — without it the
   * adapter cannot start greeting speech and returns `not_started` (no browser
   * TTS fallback). Transport only; does not play audio.
   */
  readonly synthesizeGreeting?: SynthesizeGreeting;
}
