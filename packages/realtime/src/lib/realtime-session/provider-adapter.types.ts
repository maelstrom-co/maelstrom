import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
  Unsubscribe,
  VoiceSessionState,
} from '@maelstrom-co/client';
import type { MessageId, ToolCallId } from '@maelstrom-co/protocol';

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
  /**
   * Whether this connection may present the configured fixed greeting.
   * Defaults to `true` for direct adapter callers. RealtimeSession always sets
   * this explicitly so reconnects with terminal greeting proof can skip
   * greeting-only microphone preparation.
   */
  readonly prepareGreeting?: boolean;
}

/** Provider-neutral turn-boundary mode established for the current connection. */
export type TurnMode = 'automatic' | 'manual';

/**
 * Reports the usable turn mode for the current adapter connection. `error` is
 * present only when attempted automatic control degraded to manual mode; a
 * clean event clears any diagnostic retained from an earlier mode.
 */
export interface TurnModeEvent {
  /** Event discriminator. */
  readonly type: 'turn_mode';
  /**
   * Mode ready for consumers when this event is delivered. Before emitting
   * `manual`, an adapter must expose its current {@link AdapterTurnControl}.
   */
  readonly mode: TurnMode;
  /** Automatic-mode degradation cause; omitted for a clean mode transition. */
  readonly error?: unknown;
}

/**
 * Events a `RealtimeProviderAdapter` emits toward `RealtimeSession`. This is
 * the full inbound surface — `RealtimeSession` never talks to a provider
 * through any other channel.
 */
export type RealtimeAdapterEvent =
  | {
      readonly type: 'tool_call';
      readonly callId: ToolCallId;
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
  | TurnModeEvent
  | { readonly type: 'error'; readonly error: unknown };

/**
 * Live audio streams a provider session is currently using, for UI metering
 * (voice orbs, level indicators). Fields are undefined before connect, after
 * disconnect, and — for `playback` — until the provider attaches its remote
 * audio track.
 */
export interface AdapterAudioStreams {
  readonly mic?: MediaStream;
  readonly playback?: MediaStream;
}

/**
 * Manual turn-boundary control for adapters that establish manual mode.
 * `startTurn` opens the mic / STT stream, while `endTurn` flushes it and
 * triggers the provider's turn-final transcript. An adapter may expose or
 * replace this control dynamically when automatic detection degrades; speech-
 * native providers detect turns themselves and omit it.
 *
 * An implementation decides what starting and ending a turn means; for example,
 * it may unmute a microphone, open an STT stream, or flush buffered audio.
 * Depending on the provider, calls while disconnected or with no captured
 * audio may be no-ops, and an empty turn may produce no transcript.
 * Operational failures may arrive as adapter error events while these promises
 * resolve. For a fatal {@link RealtimeVoiceError}, `RealtimeSession` exposes
 * `state === 'error'` and preserves the cause in `lastError`, so consumers must
 * observe both values.
 * {@link OpenAIAdapter} omits `turnControl` because OpenAI owns turn detection.
 *
 * Invariant: `RealtimeSession` NEVER calls these methods — they exist purely
 * for the binding/UI layer to drive. The session stays agnostic to whether a
 * provider is push-to-talk; only the surface that renders controls acts on
 * this capability.
 */
export interface AdapterTurnControl {
  /** Request the provider-defined start of a user turn; this may be a no-op. */
  startTurn(): Promise<void>;
  /** Request the provider-defined end of a turn; an empty turn may produce no transcript. */
  endTurn(): Promise<void>;
}

/**
 * Result of a settled `update_ui` tool call, as `RealtimeSession` hands it to
 * {@link RealtimeProviderAdapter.sendToolResult}. Both speak-worthy fields are
 * carried separately rather than pre-collapsed to one string, because each
 * transport phrases the reply differently: a speech-native provider (OpenAI)
 * posts the whole object and lets its own model choose the wording from both,
 * while a cascaded TTS provider (LiveKit) has no model and speaks
 * `userMessage ?? summary` verbatim.
 *
 * Keeping the fields typed here is the point of the type: renaming one is a
 * compile error in every adapter that reads it, never a silent empty utterance.
 */
export interface UpdateUIToolResult {
  /**
   * Whether the intent applied. `false` carries a user-facing `summary`
   * explaining why (bad request, render failure, still busy).
   */
  readonly ok: boolean;
  /**
   * Structural description derived from the post-render snapshot. Always
   * present for a settled call; the fallback an adapter speaks when the engine
   * surfaced no `userMessage`.
   */
  readonly summary?: string;
  /**
   * The engine LLM's own conversational reply, already phrased for speech.
   * Preferred over `summary` when present; absent (or empty/whitespace) when
   * the engine produced no reply.
   */
  readonly userMessage?: string;
}

/**
 * Everything an adapter can receive at {@link RealtimeProviderAdapter.sendToolResult}:
 * either the dual-field {@link UpdateUIToolResult} from `update_ui`, or a raw
 * snapshot from the read-only `get_ui_state` / `get_capabilities` pulls (which
 * a speech-native model reads as JSON, and a speaking adapter serializes rather
 * than voicing). The `ok` field is present only on {@link UpdateUIToolResult},
 * so adapters discriminate on it.
 */
export type ToolResult =
  | UpdateUIToolResult
  | UIStructuralSnapshot
  | CapabilitySnapshot;

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
  /** Streams for UI metering. Never throws; absent streams are undefined. */
  getAudioStreams(): AdapterAudioStreams;
  /** Sends a tool call's result back to the model. */
  sendToolResult(callId: ToolCallId, output: ToolResult): Promise<void>;
  /**
   * Pushes a terse grounding string into the model's context. The adapter
   * owns whatever latest-wins mechanics apply at the wire/session level
   * (e.g. overwriting session instructions rather than queuing utterances);
   * `RealtimeSession` additionally debounces calls into this method so the
   * adapter is never asked to collapse a rapid burst on its own.
   */
  injectGrounding(text: string): void;
  on(handler: (event: RealtimeAdapterEvent) => void): Unsubscribe;
  /**
   * Manual control for the current connection generation. It may appear,
   * change, or disappear as the adapter establishes or leaves manual mode;
   * speech-native adapters omit it.
   *
   * Invariant: `RealtimeSession` never invokes this. It delegates the current
   * value to binding/UI code only while retained `turnMode` is `manual`.
   */
  readonly turnControl?: AdapterTurnControl;
}

/** Verdict of a greeting speech attempt. */
export type GreetingSpeechResult = 'accepted' | 'not_started';

/**
 * Optional greeting-only capability. A provider opts in by also implementing
 * this; base {@link RealtimeProviderAdapter} gets no greeting methods.
 */
export interface RealtimeGreetingAdapter extends RealtimeProviderAdapter {
  /**
   * Unlock audio synchronously within a user gesture (the click that calls
   * `RealtimeSession.connect()`). Must never throw. Failures are not reported
   * from this call — they surface later via speech `not_started` (or adapter
   * events). Called at most once per real connection attempt.
   */
  activateAudio(): void;
  /**
   * Speak the exact configured text once. Call `onPlaybackStart` at the
   * provider's closest reliable playout-start boundary. Local players can use
   * the exact source start; remote transports may only prove that their first
   * frame entered the playout queue. Providers that never start must not call it.
   * `not_started` proves no provider
   * send or playback began — the only retriable outcome. `accepted` is
   * terminal: delivery is ambiguous past invocation and is never retried.
   */
  speakAssistantText(args: {
    readonly id: MessageId;
    readonly text: string;
    readonly signal: AbortSignal;
    /** Called at most once at the provider's documented playout-start boundary. */
    readonly onPlaybackStart?: () => void;
  }): Promise<GreetingSpeechResult>;
}

/** Structural guard mirroring `isAcknowledgedAssistantConnector`. */
export function isRealtimeGreetingAdapter(
  adapter: RealtimeProviderAdapter,
): adapter is RealtimeGreetingAdapter {
  return (
    'activateAudio' in adapter &&
    'speakAssistantText' in adapter &&
    typeof (adapter as RealtimeGreetingAdapter).activateAudio === 'function' &&
    typeof (adapter as RealtimeGreetingAdapter).speakAssistantText ===
      'function'
  );
}
