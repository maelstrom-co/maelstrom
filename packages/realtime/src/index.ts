/**
 * `@maelstrom-co/realtime` — provider-agnostic realtime voice session core.
 *
 * Wires a realtime LLM voice provider (OpenAI, Google, …) to a Maelstrom
 * instance via {@link RealtimeProviderAdapter}. This package owns the
 * Maelstrom-shaped logic — tool routing, speak-after-render ordering,
 * latest-wins grounding, barge-in handling, and sidechannel events — fully
 * provider-agnostic and unit-tested against a mock adapter. Concrete
 * provider transports ship as sibling packages (`@maelstrom-co/realtime-openai`,
 * `@maelstrom-co/realtime-livekit`, …) that implement
 * {@link RealtimeProviderAdapter} — import from those packages, not this
 * barrel, to pull one in.
 */

export type { ConnectAttempt } from './lib/connect-race-guard.js';
export { ConnectRaceGuard } from './lib/connect-race-guard.js';
export type {
  GreetingCoordinatorLifecycle,
  GreetingCoordinatorSnapshot,
  GreetingRunContext,
  GreetingTerminalReason,
} from './lib/greeting-coordinator.js';
export { GreetingCoordinator } from './lib/greeting-coordinator.js';
export { groundedDebounce } from './lib/realtime-session/grounding-debounce.js';
export type {
  AdapterAudioStreams,
  AdapterConnectOptions,
  AdapterGeneratedOpening,
  AdapterTurnControl,
  AdapterVoiceObservation,
  AdapterVoiceObservations,
  GreetingSpeechResult,
  RealtimeAdapterEvent,
  RealtimeGreetingAdapter,
  RealtimeProviderAdapter,
  RealtimeToolSpec,
  RealtimeTransportAdapter,
  ToolResult,
  TurnMode,
  TurnModeEvent,
  UpdateUIToolResult,
} from './lib/realtime-session/provider-adapter.types.js';
export { isRealtimeGreetingAdapter } from './lib/realtime-session/provider-adapter.types.js';
export { RealtimeSession } from './lib/realtime-session/realtime-session.js';
export type {
  ContinuousTranscriptOptions,
  GreetingState,
  RealtimeInstance,
  RealtimeSessionOptions,
  SubmitIntentResult,
  SummarizeFn,
} from './lib/realtime-session/realtime-session.types.js';
export type {
  VoiceRecoveryFragment,
  VoiceRecoveryOutcome,
  VoiceRecoverySnapshot,
} from './lib/realtime-session/realtime-session-memory.js';
export { RealtimeSessionMemory } from './lib/realtime-session/realtime-session-memory.js';
export type { RealtimeVoiceErrorCode } from './lib/realtime-voice-error.js';
export { RealtimeVoiceError } from './lib/realtime-voice-error.js';
