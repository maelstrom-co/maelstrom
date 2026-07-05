import type { Unsubscribe } from '../types.js';
import type { UiStructuralSnapshot } from './ui-structural-snapshot.js';

/** UI-facing lifecycle state common to every voice implementation. */
export type VoiceSessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

/** The short, speakable summary the model narrates after a render settles. */
export interface SpeakableResult {
  readonly summary: string;
}

/** A terse, latest-wins grounding push to the model. O(1) context budget. */
export interface GroundingUpdate {
  readonly text: string;
  readonly snapshot: UiStructuralSnapshot;
}

/**
 * The seam both voice tracks satisfy toward a Maelstrom instance: the realtime
 * track and the cascaded voice pipeline. It emits intents into the instance,
 * consumes speakable results, and receives grounding updates. Concrete
 * implementations live in `@maelstrom-co/realtime` (`RealtimeSession`) and the
 * cascade package — never in `client`.
 *
 * The v1 seam is deliberately minimal (lifecycle + state only);
 * `SpeakableResult` and `GroundingUpdate` are exported but unreferenced by
 * this interface for now. The full seam shape (intent-emission surface,
 * speakable-result and grounding-update flow) is to be settled through
 * follow-up coordination, before the contract ossifies.
 */
export interface VoiceSession {
  readonly state: VoiceSessionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: 'state', handler: (s: VoiceSessionState) => void): Unsubscribe;
}
