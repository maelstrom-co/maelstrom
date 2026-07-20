import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
  Unsubscribe,
} from '@maelstrom-co/client';
import type { SessionId, SidechannelEvent } from '@maelstrom-co/protocol';

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
 * `processIntent`, `waitForIdle` -> `commandProcessor.waitForIdle`) — this
 * interface exists so the realtime package depends on a narrow seam rather
 * than the whole `Orchestrator` surface. `getStructuralSnapshot` backs the
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
  getStructuralSnapshot(): UIStructuralSnapshot;
  getCapabilitySnapshot(): CapabilitySnapshot;
  onSettled(cb: () => void): Unsubscribe;
}

/**
 * Pure, model-free formatter turning a structural snapshot into a short
 * sentence. Injectable so callers can swap in richer copy without touching
 * sequencing logic; the default is deterministic and O(1) — grounding must
 * never involve a model call.
 *
 * Backs two paths: every latest-wins grounding push, and the fallback for an
 * `update_ui` / `get_ui_state` tool result. It is only a *fallback* for
 * `update_ui`: when the settled {@link SubmitIntentResult} carries a non-empty
 * `userMessage`, that engine reply is spoken instead — the product voice wins
 * over a structural description, and it also avoids misreporting instances the
 * engine keeps alive but hidden (which this summarizer would otherwise count).
 */
export type SummarizeFn = (snapshot: UIStructuralSnapshot) => string;

/** Options for constructing a {@link RealtimeSession}. */
export interface RealtimeSessionOptions {
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
}
