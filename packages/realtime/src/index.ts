/**
 * `@maelstrom-co/realtime` — provider-agnostic realtime voice session core.
 *
 * Wires a realtime LLM voice provider (OpenAI, Google, …) to a Maelstrom
 * instance via {@link RealtimeProviderAdapter}. This package owns the
 * Maelstrom-shaped logic — tool routing, speak-after-render ordering,
 * latest-wins grounding, barge-in handling, and sidechannel events — fully
 * provider-agnostic and unit-tested against a mock adapter. Concrete
 * provider transports live behind `./openai` and `./google` (later tasks);
 * import from those entry points, not this barrel, to pull one in.
 */
export type {
  RealtimeInstance,
  RealtimeSessionOptions,
  SummarizeFn,
} from './lib/realtime-session.js';
export { RealtimeSession } from './lib/realtime-session.js';

export type {
  AdapterConnectOptions,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
} from './lib/provider-adapter.types.js';

export { groundedDebounce } from './lib/grounding-debounce.js';
