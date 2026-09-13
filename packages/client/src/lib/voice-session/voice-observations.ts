import type { Unsubscribe } from '../types.js';

/** An observed activity value. Unknown means that no current evidence exists. */
export type VoiceActivity = 'active' | 'inactive' | 'unknown';

/** Local provider connection lifecycle, independent of conversation activity. */
export type VoiceConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

/** Media evidence for the current provider generation, never an audible-playback guarantee. */
export interface VoiceMediaObservation {
  /** Whether microphone capture is enabled, not whether the user is speaking. */
  readonly microphone: VoiceActivity;
  /** Provider or detector evidence of user speech. */
  readonly userSpeech: VoiceActivity;
  /** Evidence that remote audio is arriving, not that a person heard it. */
  readonly incomingAudio: VoiceActivity;
}

/** Current application activity only; inactivity does not prove a successful outcome. */
export interface VoiceApplicationWork {
  /** Current Engine request activity. */
  readonly planning: VoiceActivity;
  /** Current local command application activity. */
  readonly applying: VoiceActivity;
}

/** Optional host observation source. Subscribe before reading the current snapshot. */
export interface VoiceApplicationWorkSource {
  /** Reads current activity, including work submitted outside voice. */
  getSnapshot(): VoiceApplicationWork;
  /** Notifies when the current snapshot changes; returns a listener release. */
  subscribe(handler: () => void): Unsubscribe;
}

/**
 * One continuous transcript fragment. Times are milliseconds from the provider
 * connection's media origin, not wall-clock or confirmed audible-playback times.
 * Reusing an ID revises that fragment in place. Text is retained verbatim.
 */
export interface TimedTranscriptFragment {
  /** Provider-local identity, unique within a connection generation; 1–256 characters. */
  readonly id: string;
  /** Conversation role, independent of other simultaneous speakers. */
  readonly role: 'user' | 'assistant';
  /** Stable speaker identity within this connection; 1–256 characters. */
  readonly speakerId: string;
  /** Raw fragment text, including whitespace and punctuation. */
  readonly text: string;
  /** Inclusive start on the connection's media timeline. */
  readonly startMs: number;
  /** End on the same timeline, at or after startMs. */
  readonly endMs: number;
  /** Provider evidence that an utterance ends here. Absence means unknown. */
  readonly final?: boolean;
}

/** A revisable display group, separate from an authoritative conversation turn. */
export interface VoiceCaption {
  /** Stable display identity. Merges retain the oldest identity; splits retain it on the first surviving group. */
  readonly id: string;
  /** Role shared by this group's fragments. */
  readonly role: 'user' | 'assistant';
  /** Speaker shared by this group's fragments. */
  readonly speakerId: string;
  /** Fragment identities in timestamp order. */
  readonly fragmentIds: readonly string[];
  /** Exact concatenation of fragment text, without inserted separators. */
  readonly text: string;
  /** Earliest retained fragment start. */
  readonly startMs: number;
  /** Latest retained fragment end. */
  readonly endMs: number;
  /** True only when the last fragment explicitly reports an utterance end. Display fading never sets this. */
  readonly final: boolean;
}

/** Shared, bounded observations for a voice session. Legacy turns use a separate channel. */
export interface VoiceObservationSnapshot {
  /** Local connection attempt number; timestamps and fragment IDs are scoped to this value. */
  readonly generation: number;
  /** Provider connection lifecycle, not a conversation turn state. */
  readonly connection: VoiceConnectionState;
  /** Current generation's observed media activity. */
  readonly media: VoiceMediaObservation;
  /** Current application observations, independent of voice connectivity. */
  readonly applicationWork: VoiceApplicationWork;
  /** Bounded raw fragments ordered by start time, then first receipt for ties; reset on a new connection attempt. */
  readonly fragments: readonly TimedTranscriptFragment[];
  /** Revisable display groups derived from the retained fragments. */
  readonly captions: readonly VoiceCaption[];
}

/** Additive observation capability; neither VoiceSession nor its event unions change. */
export interface VoiceObservationSource {
  /** Reads a referentially stable snapshot until observations change. */
  getSnapshot(): VoiceObservationSnapshot;
  /** Subscribes to changes. Subscribe before reading to avoid missed updates. */
  subscribe(handler: () => void): Unsubscribe;
}
