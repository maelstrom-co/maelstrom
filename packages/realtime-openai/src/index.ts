/**
 * `@maelstrom-co/realtime-openai` — a {@link RealtimeProviderAdapter} that
 * connects the browser directly to OpenAI `gpt-realtime` over WebRTC.
 *
 * Shipped as a package separate from `@maelstrom-co/realtime` so consumers of
 * the core never have this adapter's WebRTC glue, data-channel parsing, and
 * response-lifecycle bookkeeping forced on them — pull this in only when you
 * want the OpenAI speech-native transport. The Node-only client-secret minter
 * lives in the sibling `@maelstrom-co/realtime-openai-server` package; the
 * wire contracts imported here from `@maelstrom-co/realtime-protocol/openai`
 * are the same ones that minter validates against, so both sides read the
 * exact same source of truth.
 */
export * from '@maelstrom-co/realtime-protocol/openai';
export type {
  BrowserVadOptions,
  BrowserVadProviderOptions,
} from '@maelstrom-co/realtime-vad/config';
export { OpenAIAdapter } from './openai-adapter.js';
export type {
  OpenAIAdapterOptions,
  SynthesizeGreeting,
  SynthesizeGreetingArgs,
} from './openai-adapter.types.js';
