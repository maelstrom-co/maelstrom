// Wire constants shared by the browser adapter and the agent worker. Zero
// imports on purpose: the worker reaches these through
// `@maelstrom-co/realtime-protocol/livekit-wire`, which must never pull in
// browser or server dependencies — not even zod. This is the single source of
// truth both sides read so the topic strings can never drift.

/** Text-stream topic the client uses to send TTS requests to the worker. */
export const SPEAK_TOPIC = 'speak';

/**
 * Identity the browser client connects to the room with, and the identity the
 * worker waits for on join and filters incoming tracks against. A room-wide
 * constant (not per-session) because the spike supports exactly one human
 * participant per room.
 */
export const USER_PARTICIPANT_IDENTITY = 'user';

/**
 * Data topic for client→worker turn control: `turn_end` (flush the STT buffer)
 * and `tts_cancel` (barge-in — abort the in-flight TTS so old audio stops).
 */
export const TURN_TOPIC = 'turn';

/**
 * Data topic the worker uses to report TTS status back to the client: a
 * `tts_started` after the first frame enters the worker's playout queue, `tts_done` when
 * playout of a summary finishes (so the client can collapse
 * `speaking`→`connected` on actual audio end, not on text hand-off), or a
 * `tts_error` when synthesis fails.
 */
export const TTS_TOPIC = 'tts';

/**
 * Attribute key carrying the utterance id on a `SPEAK_TOPIC` text stream. The
 * client (which initiates each utterance) stamps a monotonic id here; the worker
 * echoes it on the matching `TTS_TOPIC` status packet ({@link TtsDoneMessage} /
 * {@link TtsErrorMessage}) so the client can drop status for an utterance it has
 * already barged past — a cancelled utterance's late `tts_done` must not clear
 * the client's thinking fallback or move state, or the UI wedges in `thinking`.
 */
export const SPEAK_UTTERANCE_ID_ATTR = 'mae-utterance-id';

/** Sent browser adapter → worker on the `TURN_TOPIC` to flush the STT buffer. */
export interface TurnEndMessage {
  type: 'turn_end';
  /** Correlated extension; all three identity fields must be present together. */
  version?: 1;
  /** Connection nonce negotiated before correlated turns begin. */
  nonce?: string;
  /** Contiguous positive source ordinal captured by the browser at turn start. */
  turnId?: number;
  /** A cancelled/local-drain-failed turn must never produce actionable text. */
  cancelled?: boolean;
}

/** Reliable worker-to-browser capability and terminal-result data topic. */
export const TRIGGER_TURN_TOPIC = 'trigger-turn';

/** Requests version-one correlation; repeating the same nonce is retry-safe. */
export interface TurnCapabilityMessage {
  /** Capability request discriminator. */
  readonly type: 'turn_capability';
  /** Correlated-turn protocol version. */
  readonly version: 1;
  /** Nonempty connection identifier, at most 128 ASCII identifier characters. */
  readonly nonce: string;
}

/** Confirms protocol support, not microphone/STT-handler readiness. */
export interface TurnCapabilityAck {
  /** Capability acknowledgement discriminator. */
  readonly type: 'turn_capability_ack';
  /** Supported correlated-turn protocol version. */
  readonly version: 1;
  /** Echo of the requesting connection identifier. */
  readonly nonce: string;
  /** Validated worker drain budget in milliseconds, positive and at most 60000. */
  readonly drainTimeoutMs: number;
}

/** One logical outcome for a correlated boundary; errors never carry partial text. */
export interface TriggerTurnResult {
  /** Terminal-result discriminator. */
  readonly type: 'turn_result';
  /** Correlated-turn protocol version. */
  readonly version: 1;
  /** Connection owning this boundary, never reassigned on delivery. */
  readonly nonce: string;
  /** Positive source ordinal echoed from the accepted boundary. */
  readonly turnId: number;
  /** Success requires complete provider drain; empty and error cannot activate. */
  readonly outcome: 'success' | 'empty' | 'error';
  /** Nonempty fully drained final text on success, otherwise the empty string. */
  readonly text: string;
}

/** Validated correlated boundary, including an optional explicit cancellation. */
export interface CorrelatedTurnEnd extends TurnEndMessage {
  /** Version required for correlated control. */
  version: 1;
  /** Connection owning this boundary. */
  nonce: string;
  /** Positive source ordinal; duplicate delivery must not advance the FIFO. */
  turnId: number;
}

/** Dependency-free union of validated correlation packets on either direction. */
export type TriggerTurnPacket =
  | TurnCapabilityMessage
  | TurnCapabilityAck
  | CorrelatedTurnEnd
  | TriggerTurnResult;

/**
 * Parses bounded correlation packets without throwing. Unknown versions, partial
 * identities, invalid budgets, and non-success text reject. Legacy controls are
 * intentionally not accepted here; their normal-mode listener remains separate.
 * Sender authorization is the transport owner's responsibility.
 */
export function parseTriggerTurnPacket(
  payload: Uint8Array,
): TriggerTurnPacket | null {
  if (payload.byteLength > 262_144) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const packet = value as Record<string, unknown>;
  if (
    packet.version !== 1 ||
    typeof packet.nonce !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(packet.nonce)
  )
    return null;
  const base = { version: 1 as const, nonce: packet.nonce };
  if (packet.type === 'turn_capability') return { ...base, type: packet.type };
  if (packet.type === 'turn_capability_ack') {
    const budget = packet.drainTimeoutMs;
    return typeof budget === 'number' &&
      Number.isFinite(budget) &&
      budget > 0 &&
      budget <= 60_000
      ? { ...base, type: packet.type, drainTimeoutMs: budget }
      : null;
  }
  if (
    typeof packet.turnId !== 'number' ||
    !Number.isSafeInteger(packet.turnId) ||
    packet.turnId < 1
  )
    return null;
  const identity = { ...base, turnId: packet.turnId };
  if (packet.type === 'turn_end') {
    if (packet.cancelled !== undefined && typeof packet.cancelled !== 'boolean')
      return null;
    return {
      ...identity,
      type: packet.type,
      ...(packet.cancelled === undefined
        ? {}
        : { cancelled: packet.cancelled }),
    };
  }
  if (packet.type !== 'turn_result' || typeof packet.text !== 'string')
    return null;
  if (packet.outcome === 'success' && packet.text.trim()) {
    return {
      ...identity,
      type: packet.type,
      outcome: packet.outcome,
      text: packet.text,
    };
  }
  if (
    (packet.outcome === 'empty' || packet.outcome === 'error') &&
    packet.text === ''
  ) {
    return {
      ...identity,
      type: packet.type,
      outcome: packet.outcome,
      text: '',
    };
  }
  return null;
}

/**
 * Sent browser adapter → worker on the `TURN_TOPIC` when the user barges in
 * while the assistant is speaking: aborts the in-flight Cartesia TTS so the
 * queued audio stops near-instantly instead of playing to completion.
 */
export interface TtsCancelMessage {
  type: 'tts_cancel';
}

/** Data topic the worker uses to announce SPEAK_TOPIC and TTS-track readiness. */
export const TTS_READY_TOPIC = 'tts-ready';

/** Payload of the single per-job readiness packet. */
export interface TtsReadyMessage {
  readonly type: 'tts_ready';
}

/** Sent worker → browser adapter on the `TTS_TOPIC` when TTS synthesis fails. */
export interface TtsErrorMessage {
  type: 'tts_error';
  /**
   * The utterance this status refers to, echoed from the speak request's
   * {@link SPEAK_UTTERANCE_ID_ATTR}. Absent when the worker never received an id
   * (older/id-less speak requests); the client then falls back to type-only
   * handling.
   */
  utteranceId?: number;
}

/**
 * Sent worker → browser adapter after the first synthesized frame enters the
 * LiveKit AudioSource queue. This is the nearest provider boundary available;
 * it does not prove that the browser has rendered the frame audibly.
 */
export interface TtsStartedMessage {
  /** Identifies this status as the first-frame start boundary. */
  readonly type: 'tts_started';
  /** The utterance this status refers to. Required so stale starts are rejected. */
  readonly utteranceId: number;
}

/** Sent worker → browser adapter on the `TTS_TOPIC` when TTS playout finishes. */
export interface TtsDoneMessage {
  type: 'tts_done';
  /** The utterance this status refers to — see {@link TtsErrorMessage.utteranceId}. */
  utteranceId?: number;
}
