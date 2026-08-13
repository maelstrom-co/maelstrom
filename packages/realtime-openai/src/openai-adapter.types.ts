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
