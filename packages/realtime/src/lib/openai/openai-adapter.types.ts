import type { OpenAITokenGrant } from '@maelstrom-co/realtime-protocol/openai';

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
}
