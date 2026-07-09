import type { Unsubscribe } from '../types.js';
import type { UIStructuralSnapshot } from './ui-structural-snapshot.js';

/**
 * UI-facing lifecycle state common to every voice implementation. `idle` is
 * "not connected" (before `connect()` and after `disconnect()`); `connected`
 * is the transport being live but not yet in an active listening/thinking/
 * speaking turn — collapsing it into `idle` would make a live session
 * indistinguishable from a disconnected one.
 */
export type VoiceSessionState =
  | 'idle'
  | 'connecting'
  | 'connected'
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
  readonly snapshot: UIStructuralSnapshot;
}

/**
 * One utterance fragment from either side of the voice conversation.
 *
 * Non-final entries are streaming fragments; consumers accumulate fragments
 * per role while `final` is false and replace the accumulation when the
 * `final: true` entry for that utterance arrives.
 */
export interface TranscriptEntry {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly final: boolean;
}

/**
 * The seam both voice tracks satisfy toward a Maelstrom instance: the realtime
 * track and the cascaded voice pipeline. It emits intents into the instance,
 * consumes speakable results, and receives grounding updates. Concrete
 * implementations live in `@maelstrom-co/realtime` (`RealtimeSession`) and the
 * cascade package — never in `client`.
 *
 * The v1 seam is deliberately minimal (lifecycle + state, plus a transcript
 * channel for live captions); `SpeakableResult` and `GroundingUpdate` are
 * exported but unreferenced by this interface for now. The full seam shape
 * (intent-emission surface, speakable-result and grounding-update flow) is to
 * be settled through follow-up coordination, before the contract ossifies.
 */
export interface VoiceSession {
  readonly state: VoiceSessionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: 'state', handler: (s: VoiceSessionState) => void): Unsubscribe;
  on(event: 'transcript', handler: (t: TranscriptEntry) => void): Unsubscribe;
}
