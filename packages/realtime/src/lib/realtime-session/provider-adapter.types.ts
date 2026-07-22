import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
  Unsubscribe,
  VoiceSessionState,
} from "@maelstrom-co/client";
import type { ToolCallId } from "@maelstrom-co/protocol";

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
      readonly type: "tool_call";
      readonly callId: ToolCallId;
      readonly name: string;
      readonly argumentsJson: string;
    }
  | {
      readonly type: "transcript";
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly final: boolean;
    }
  | { readonly type: "speech_started" }
  | { readonly type: "state"; readonly state: VoiceSessionState }
  | { readonly type: "error"; readonly error: unknown };

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
 * Optional turn-boundary control for providers that lack server-side VAD and
 * therefore cannot detect turn edges on their own. Cascaded STT→LLM→TTS
 * transports (push-to-talk) need the user to delimit each turn explicitly:
 * `startTurn` opens the mic / STT stream, `endTurn` flushes it and triggers
 * the provider's turn-final transcript. Speech-native providers (OpenAI
 * WebRTC, Google Live API) detect turns themselves and omit this entirely.
 *
 * Invariant: `RealtimeSession` NEVER calls these methods — they exist purely
 * for the binding/UI layer to drive. The session stays agnostic to whether a
 * provider is push-to-talk; only the surface that renders controls acts on
 * this capability.
 */
export interface AdapterTurnControl {
  /** Begin a user turn (e.g. unmute mic, start STT stream). */
  startTurn(): Promise<void>;
  /** End the turn (flush STT, mute mic). Triggers the provider's turn-final transcript. */
  endTurn(): Promise<void>;
}

/** Options for one browser-detected automatic turn. */
export interface AdapterAutomaticTurnOptions {
  /** Browser-local audio to replay once before live audio begins. */
  readonly preRollMs: number;
}

/**
 * Optional automatic-turn capability for cascaded providers that can retain a
 * bounded browser-local mic tail while upstream audio is paused. Unlike
 * {@link AdapterTurnControl}, this capability is driven only by browser VAD and
 * guarantees that pre-roll is emitted once before live audio. Unsupported or
 * failed implementations reject so the binding can fail closed to manual mode.
 */
export interface AdapterAutomaticTurnControl {
  /** Whether this connection has a live, upstream-gated audio generation. */
  isAvailable(): boolean;
  /**
   * Captures turn operations for the current provider connection. Adapters
   * with reconnectable transports should return a generation-bound handle so
   * delayed cleanup from a retired browser VAD controller becomes a no-op
   * rather than closing a newer connection's turn. Bindings fail closed to
   * manual mode when this additive capability is absent.
   */
  createHandle?(): Pick<AdapterAutomaticTurnControl, "startTurn" | "endTurn">;
  /** Replays the requested local tail, then opens automatic live forwarding. */
  startTurn(options: AdapterAutomaticTurnOptions): Promise<void>;
  /**
   * Drains pending automatic audio before closing the turn.
   *
   * A rejection normally means the turn was not finalized and may still need
   * cleanup. If finalization succeeded but an advisory drain/cleanup failure
   * must still be reported, the rejection must carry `turnFinalized: true`.
   * Bindings use that provider-neutral marker to report the error and fall back
   * without sending the turn boundary a second time.
   */
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
   * Present only on adapters that need explicit turn boundaries (push-to-talk
   * cascades without server-side VAD); speech-native adapters omit it.
   *
   * Invariant: `RealtimeSession` NEVER touches this — it is surfaced to the
   * binding/UI layer, which uses `turnControl !== undefined` as the type-level
   * signal to render hold-to-talk controls instead of an always-on listening
   * orb, and drives {@link AdapterTurnControl.startTurn}/`endTurn` from those
   * controls.
   */
  readonly turnControl?: AdapterTurnControl;
  /**
   * Capability for bounded local pre-roll on browser-detected turns. It may be
   * present before connect; callers must check `isAvailable()` for the current
   * audio generation. Manual controls continue to use {@link turnControl}.
   */
  readonly automaticTurnControl?: AdapterAutomaticTurnControl;
}
