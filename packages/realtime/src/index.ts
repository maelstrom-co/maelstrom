/**
 * `@maelstrom-co/realtime` — provider-agnostic realtime voice session core.
 *
 * Wires a realtime LLM voice provider (OpenAI, Google, …) to a Maelstrom
 * instance via {@link RealtimeProviderAdapter}. This package owns the
 * Maelstrom-shaped logic — tool routing, speak-after-render ordering,
 * latest-wins grounding, barge-in handling, and sidechannel events — fully
 * provider-agnostic and unit-tested against a mock adapter. Concrete
 * provider transports live behind `./openai`; additional providers ship as
 * sibling subpaths — import from those entry points, not this barrel, to
 * pull one in.
 */

export type { ConnectAttempt } from './lib/connect-race-guard.js';
export { ConnectRaceGuard } from './lib/connect-race-guard.js';
export { groundedDebounce } from './lib/realtime-session/grounding-debounce.js';
export type {
  AdapterAudioStreams,
  AdapterAutomaticTurnControl,
  AdapterAutomaticTurnOptions,
  AdapterConnectOptions,
  AdapterTurnControl,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
  ToolResult,
  UpdateUIToolResult,
} from './lib/realtime-session/provider-adapter.types.js';
export { RealtimeSession } from './lib/realtime-session/realtime-session.js';
export type {
  RealtimeInstance,
  RealtimeSessionOptions,
  SubmitIntentResult,
  SummarizeFn,
} from './lib/realtime-session/realtime-session.types.js';
export type { RealtimeVoiceErrorCode } from './lib/realtime-voice-error.js';
export { RealtimeVoiceError } from './lib/realtime-voice-error.js';
export type {
  MintFailure,
  MintFailureReason,
  MintFetch,
} from './lib/token/mint.js';
export { mintFailureHttpStatus } from './lib/token/mint.js';
export type { TokenGrant } from './lib/token/token-grant.js';
export type { UnixSeconds } from './lib/token/unix-seconds.js';
export { UnixSecondsSchema } from './lib/token/unix-seconds.js';
