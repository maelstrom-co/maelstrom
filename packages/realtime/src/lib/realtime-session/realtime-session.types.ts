import type {
  CapabilitySnapshot,
  UIStructuralSnapshot,
  Unsubscribe,
} from '@maelstrom-co/client';
import type { SessionId, SidechannelEvent } from '@maelstrom-co/protocol';

import type { RealtimeProviderAdapter } from './provider-adapter.types.js';

/**
 * The minimal bridge `RealtimeSession` needs from a Maelstrom instance.
 * `Orchestrator` maps onto this via a small wrapper (`submitIntent` ->
 * `processIntent`, `waitForIdle` -> `commandProcessor.waitForIdle`) — this
 * interface exists so the realtime package depends on a narrow seam rather
 * than the whole `Orchestrator` surface. `getStructuralSnapshot` backs the
 * `get_ui_state` pull (what's on screen); `getCapabilitySnapshot` backs the
 * `get_capabilities` pull (what CAN be shown).
 */
export interface RealtimeInstance {
  submitIntent(intent: string): Promise<void>;
  waitForIdle(): Promise<void>;
  getStructuralSnapshot(): UIStructuralSnapshot;
  getCapabilitySnapshot(): CapabilitySnapshot;
  onSettled(cb: () => void): Unsubscribe;
}

/**
 * Pure, model-free formatter turning a structural snapshot into a short
 * sentence for grounding text or a `get_ui_state` / `update_ui` tool result.
 * Injectable so callers can swap in richer copy without touching sequencing
 * logic; the default is deterministic and O(1) — grounding must never
 * involve a model call.
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
