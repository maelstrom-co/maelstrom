import type { TokenHandshakeResponse } from '@maelstrom-co/protocol';

/** Options for constructing an {@link OpenAIAdapter}. */
export interface OpenAIAdapterOptions {
  /**
   * Mints the ephemeral OpenAI realtime client secret this adapter connects
   * with. Called once per `connect()`. The token handshake is assigned to
   * the adapter — `RealtimeSession` never sees a credential.
   */
  readonly mintToken: () => Promise<TokenHandshakeResponse>;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
}
