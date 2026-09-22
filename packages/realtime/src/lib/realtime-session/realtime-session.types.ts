import type {
  AssistantMessageOutcome,
  CapabilitySnapshot,
  Result,
  UIStructuralSnapshot,
  Unsubscribe,
} from '@maelstrom-co/client';
import type {
  MessageId,
  SessionId,
  SidechannelEvent,
} from '@maelstrom-co/protocol';

import type { GreetingCoordinator } from '../greeting-coordinator.js';
import type { RealtimeProviderAdapter } from './provider-adapter.types.js';

/**
 * What submitting an intent tells the voice layer, narrowed to what it speaks.
 *
 * `userMessage` is the engine LLM's conversational reply to the user — already
 * context-aware and phrased for speech (e.g. "Done — here are your labs")
 * rather than a structural description. When present it is spoken verbatim as
 * the `update_ui` tool result, taking precedence over the snapshot summarizer
 * (see {@link SummarizeFn}). It is optional on the seam so an instance that
 * cannot surface an engine reply can omit it; the session then falls back to
 * summarizing the post-render snapshot. An empty or whitespace-only string is
 * treated the same as absent.
 */
export interface SubmitIntentResult {
  readonly userMessage?: string;
}

/**
 * The minimal bridge `RealtimeSession` needs from a Maelstrom instance.
 * `Orchestrator` maps onto this via a small wrapper (`submitIntent` ->
 * `processIntent`, `waitForIdle` and `waitForIdleResult` ->
 * `commandProcessor.waitForIdle`) — this interface exists so the realtime
 * package depends on a narrow seam rather than the whole `Orchestrator`
 * surface. `getStructuralSnapshot` backs the
 * `get_ui_state` pull (what's on screen); `getCapabilitySnapshot` backs the
 * `get_capabilities` pull (what CAN be shown).
 *
 * `submitIntent` resolves with a {@link SubmitIntentResult} carrying the
 * engine's conversational `userMessage`, so the session can speak the engine's
 * own reply instead of a structural summary once the change settles. It still
 * rejects with `RequestInFlightError` while a prior intent is applying — that
 * contract drives the barge-in queue and is unchanged.
 */
export interface RealtimeInstance {
  submitIntent(intent: string): Promise<SubmitIntentResult>;
  waitForIdle(): Promise<void>;
  /**
   * Result-bearing settle wait, preferred over {@link RealtimeInstance.waitForIdle}
   * wherever the session needs to know whether the settled work succeeded.
   *
   * It is optional so that an instance written against the void-only
   * {@link RealtimeInstance.waitForIdle} still satisfies this interface; a
   * session that finds it absent falls back to that wait and can only treat
   * every settle as successful. An `Orchestrator`-backed instance supplies it
   * directly, because `commandProcessor.waitForIdle()` already resolves with
   * this {@link Result}.
   *
   * A `!ok` result means the settled work failed — a refused `set_layout`
   * (duplicate tiling leaf, malformed weight token) being the ordinary case.
   * Such a refusal neither throws nor rejects and leaves the previous screen
   * in place, so this is the only signal that the intent changed nothing, and
   * `RealtimeSession` answers the `update_ui` tool call as a failure rather
   * than describing a snapshot the intent never produced. Like
   * {@link RealtimeInstance.waitForIdle} it must never reject: the barge-in
   * retry loop awaits it outside any catch.
   */
  waitForIdleResult?(): Promise<Result<void, Error>>;
  getStructuralSnapshot(): UIStructuralSnapshot;
  getCapabilitySnapshot(): CapabilitySnapshot;
  onSettled(cb: () => void): Unsubscribe;
  /**
   * Persist an assistant message with the engine's existing MessageId dedup.
   * `'inserted'` is positive evidence this runtime owns first insertion;
   * `'deduped'` means an earlier attempt already landed.
   */
  addAssistantMessageAcknowledged(args: {
    readonly id: MessageId;
    readonly message: string;
  }): Promise<AssistantMessageOutcome>;
  /**
   * Observe engine connection readiness. Subscribe first, then the current
   * status is delivered synchronously (subscribe-then-snapshot), so an
   * already-connected engine resolves immediately and a not-connected engine
   * delivers `false` now and `true` on the next transition.
   */
  observeEngineConnection(cb: (connected: boolean) => void): Unsubscribe;
}

/**
 * Pure, model-free formatter turning a structural snapshot into a short
 * sentence. Injectable so callers can swap in richer copy without touching
 * sequencing logic; the default is deterministic and O(1) — grounding must
 * never involve a model call.
 *
 * Backs two paths: every latest-wins grounding push and the structural
 * fallback summary for an `update_ui` tool result. It does not summarize the
 * direct `get_ui_state` pull, which returns its {@link UIStructuralSnapshot}
 * directly. That snapshot already contains visible-only Instances. When the
 * settled {@link SubmitIntentResult} carries a non-empty `userMessage`, that
 * engine reply remains the preferred product voice over the structural
 * fallback.
 */
export type SummarizeFn = (snapshot: UIStructuralSnapshot) => string;

/**
 * Retained presentation lifecycle of the shared session's fixed greeting.
 *
 * `preparing` begins synchronously before the provider handshake and spans all
 * greeting work, including a wait for Engine readiness that has no timeout.
 * `settled` means that the current generation's greeting presentation has
 * finished; it does not report provider activity or prove that speech
 * succeeded. `skipped` is the explicit, terminal user choice not to present
 * the greeting. A retryable disconnect or abort returns a configured greeting
 * to `pending`, while retained terminal proof keeps `settled` or `skipped`
 * across session recreation. Work from a stale connection generation cannot
 * change the retained state.
 *
 * This lifecycle is independent of `VoiceSessionState`, errors, transcripts,
 * and turn mode.
 */
export type GreetingState =
  /** No fixed greeting was supplied; connection activity cannot change this. */
  | 'not_configured'
  /** A configured greeting is dormant and may run on a later connection. */
  | 'pending'
  /** Provider connection or greeting work is active, possibly waiting indefinitely for the Engine. */
  | 'preparing'
  /** Presentation ended for the current generation; this does not imply speech success. */
  | 'settled'
  /** The user synchronously skipped this configured greeting; terminal for this session. */
  | 'skipped';

/** Options for constructing a {@link RealtimeSession}. */
export interface RealtimeSessionOptions {
  /** Optional voice activation policy; omission preserves normal voice and greetings. */
  readonly activation?: VoiceActivationConfig;
  readonly adapter: RealtimeProviderAdapter;
  readonly instance: RealtimeInstance;
  /**
   * Maelstrom session this realtime session belongs to. Stamped onto every
   * emitted {@link SidechannelEvent}. Must match the session the `instance`
   * runs under (e.g. the Orchestrator's own session).
   */
  readonly sessionId: SessionId;
  /** Debounce window for latest-wins grounding pushes. Defaults to 1000ms. */
  readonly groundingDebounceMs?: number;
  readonly summarize?: SummarizeFn;
  readonly onEvent?: (event: SidechannelEvent) => void;
  /** Enable verbose debug tracing (default false). */
  readonly debug?: boolean;
  /**
   * Optional one-shot spoken greeting. The coordinator is owned by the
   * maelstrom-realtime layer (one per Orchestrator) so session recreation
   * reuses retained proofs. Never constructed inside {@link RealtimeSession}.
   */
  readonly greeting?: {
    readonly text: string;
    readonly coordinator: GreetingCoordinator;
  };
}

/**
 * Voice admission policy, independent of automatic/manual turn detection.
 * Trigger mode consumes the matching utterance without a greeting. Distinct
 * source-ordered requests after it are held privately through the activation
 * hook and admitted afterwards, including finals delivered before the trigger
 * final. Waiting still captures provider STT and may incur usage; it is neither
 * hardware mute nor a provider-data erasure guarantee. Change policy only while
 * stopped. Invalid phrase/duration settings throw rather than being clamped.
 */
export type VoiceActivationConfig =
  | {
      /** Preserve existing voice behavior, including configured greetings. */
      readonly mode: 'normal';
    }
  | {
      /** Keep provider STT running while excluding non-admitted speech from application work. */
      readonly mode: 'trigger';
      /** Whole finalized utterance, 1–200 Unicode code points with nonempty normalized words. Case and separating punctuation are ignored; accents and internal apostrophes are preserved. */
      readonly phrase: string;
      /** Full-turn idle interval in integer milliseconds, 1,000–600,000; defaults to 10,000. Never cancels playback. */
      readonly inactivityMs?: number;
      /** Count connection-lived chat tokens through render completion; defaults to false. Chat cannot activate voice. */
      readonly includeChatActivity?: boolean;
      /** Runs before admission opens; fails open on throw, rejection or a 2-second timeout. Return values cannot veto activation. */
      readonly onActivate?: VoiceActivationHook;
      /** Runs after full-turn inactivity; new work aborts this attempt and retains active admission. Otherwise fails open after 2 seconds. */
      readonly onDeactivate?: VoiceActivationHook;
    };

/** Retained activation policy; disconnected trigger sessions remain waiting, so present connection state first. */
export type VoiceActivationState =
  | 'disabled'
  | 'waiting'
  | 'activating'
  | 'active'
  | 'deactivating';

/** Bounded notification hook. Abortion fences core transitions but cannot undo arbitrary host side effects. Failures log a fixed category only. */
export type VoiceActivationHook = (context: {
  /** Aborted on timeout, disconnect, or superseding activity/epoch. */
  readonly signal: AbortSignal;
  /** Trigger match opens admission; full-turn inactivity closes it. */
  readonly reason: 'trigger' | 'inactivity';
}) => unknown;
