import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';

/**
 * A single tool exposed to the realtime model, in provider-neutral form.
 * Concrete adapters translate this into whatever shape their provider's
 * session-config wire format wants (OpenAI's `tools[]`, Google's
 * `functionDeclarations`, …).
 */
export interface RealtimeToolSpec<Name extends string = string> {
  readonly name: Name;
  readonly description: string;
  /** JSON Schema for the tool's arguments object. */
  readonly parametersJsonSchema: unknown;
}

/** Options a `RealtimeSession` hands an adapter on `connect`. */
export interface AdapterConnectOptions {
  readonly tools: readonly RealtimeToolSpec[];
  readonly instructions: string;
}

/**
 * Events a `RealtimeProviderAdapter` emits toward `RealtimeSession`. This is
 * the full inbound surface — `RealtimeSession` never talks to a provider
 * through any other channel.
 */
export type RealtimeAdapterEvent =
  | {
      readonly type: 'tool_call';
      readonly callId: string;
      readonly name: string;
      readonly argumentsJson: string;
    }
  | {
      readonly type: 'transcript';
      readonly role: 'user' | 'assistant';
      readonly text: string;
      readonly final: boolean;
    }
  | { readonly type: 'speech_started' }
  | { readonly type: 'state'; readonly state: VoiceSessionState }
  | { readonly type: 'error'; readonly error: unknown };

/**
 * Provider-agnostic seam a realtime voice transport (OpenAI WebRTC, Google
 * Live API, …) implements. `RealtimeSession` drives every provider through
 * this interface only — it never branches on provider identity. Concrete
 * transports live in `./openai`; additional providers ship as sibling
 * subpaths.
 */
export interface RealtimeProviderAdapter {
  /**
   * Opens the provider connection. The adapter mints its own ephemeral
   * credential internally on connect — `RealtimeSession` never passes one
   * in.
   */
  connect(opts: AdapterConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  /** Sends a tool call's result back to the model. */
  sendToolResult(callId: string, output: unknown): Promise<void>;
  /**
   * Pushes a terse grounding string into the model's context. The adapter
   * owns whatever latest-wins mechanics apply at the wire/session level
   * (e.g. overwriting session instructions rather than queuing utterances);
   * `RealtimeSession` additionally debounces calls into this method so the
   * adapter is never asked to collapse a rapid burst on its own.
   */
  injectGrounding(text: string): void;
  on(handler: (event: RealtimeAdapterEvent) => void): Unsubscribe;
}
