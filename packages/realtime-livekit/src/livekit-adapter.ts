import { Logger } from '@maelstrom-co/client';
import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterAudioStreams,
  AdapterConnectOptions,
  AdapterTurnControl,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  ToolResult,
} from '@maelstrom-co/realtime';
import { ConnectRaceGuard, RealtimeVoiceError } from '@maelstrom-co/realtime';
import { Room, RoomEvent, Track, setLogLevel } from 'livekit-client';
import type { RemoteTrack, TranscriptionSegment } from 'livekit-client';

import type { LiveKitAdapterOptions } from './livekit-adapter.types.js';
import type { TtsCancelMessage, TurnEndMessage } from './protocol.js';
import {
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TTS_TOPIC,
  TURN_TOPIC,
} from './protocol.js';

// Quiet the livekit-client SDK's verbose signal/connection logging (which dumps
// the full connect URL on every join). Warnings and errors still surface.
setLogLevel('warn');

/**
 * A {@link RealtimeProviderAdapter} backed by a LiveKit cascaded STT/TTS
 * pipeline instead of a speech-native realtime model. It joins a LiveKit room,
 * publishes a hold-to-talk mic, and — this is the spike's core idea —
 * **synthesizes an `update_ui` tool call from each final user transcript** so a
 * cascaded pipeline drives the exact same {@link RealtimeSession} machinery
 * (speak-after-render, barge-in, sidechannel events) as the OpenAI realtime
 * adapter, with no LLM in the loop on either side.
 *
 * A companion worker (`@maelstrom-co/realtime-livekit-agent`) owns the actual
 * STT (Deepgram) and TTS (Cartesia); this adapter only relays over the room:
 * transcripts in (`RoomEvent.TranscriptionReceived`), speak text out
 * (`SPEAK_TOPIC`). Tool calls, tool results, and speak-after-render sequencing
 * are all `RealtimeSession`'s concern — the same code path every provider uses.
 *
 * The WebRTC/room plumbing itself is not unit-tested; the transcript →
 * tool-call synthesis, tool-result → speak-topic payload, and state mapping it
 * delegates to are.
 *
 * @example
 * ```ts
 * const adapter = new LiveKitAdapter({
 *   mintToken: (roomName) => fetchLiveKitToken(roomName),
 *   roomName: `maelstrom-${sessionId}`,
 * });
 * const session = new RealtimeSession({ adapter, instance, sessionId });
 * await session.connect();
 * // Hold-to-talk, driven from the demo UI holding the concrete instance:
 * await adapter.turnControl.startTurn();
 * await adapter.turnControl.endTurn();
 * ```
 */
export class LiveKitAdapter implements RealtimeProviderAdapter {
  readonly #mintToken: LiveKitAdapterOptions['mintToken'];
  readonly #roomName: string;
  readonly #logger: Logger;
  readonly #handlers = new Set<(event: RealtimeAdapterEvent) => void>();

  #room: Room | undefined;
  #audioEl: HTMLAudioElement | undefined;
  #playbackStream: MediaStream | undefined;
  // Last state emitted, so the deferred `speaking`→`connected` collapse can be
  // skipped when a newer state (a barge-in `listening`) already superseded it.
  #lastState: VoiceSessionState | undefined;
  // Guards the window between connect() being called and `#room` being
  // usable — `mintToken()` and `room.connect()` are awaited, so without this a
  // second connect() during that round-trip would open a second room.
  #connecting = false;
  // Set while the adapter itself is tearing the room down (disconnect()), so the
  // resulting RoomEvent.Disconnected is recognized as expected and stays silent.
  // An unexpected drop (server/network) leaves this false and surfaces as fatal.
  #closing = false;
  // Detects, once each in-flight connect() await (mint, room join, mic publish)
  // resumes, that a disconnect()/teardown or a newer connect() overtook it — so
  // the stale attempt abandons its own room instead of joining one nobody owns.
  readonly #connectGuard = new ConnectRaceGuard();
  #callSeq = 0;
  // Distinct non-fatal failure kinds already warned about this connection
  // (TTS read-back failures, a torn-down room racing a tool result), so each
  // warns once per kind instead of flooding the console.
  readonly #warnedNonFatalKinds = new Set<string>();
  readonly #thinkingFallbackMs: number;
  // Monotonic id stamped on each speak request; the worker echoes it on the
  // matching TTS status packet so stale status can be correlated and dropped.
  #utteranceSeq = 0;
  // The utterance whose TTS status the client currently accepts. Set when a speak
  // is handed off; cleared on a barge-in (tts_cancel) so the cancelled
  // utterance's late `tts_done` is recognized as stale and ignored — without
  // this, that late packet clears the empty-turn fallback and wedges `thinking`.
  #currentUtteranceId: number | undefined;
  // Rescues an empty push-to-talk turn (no speech) that would otherwise wedge
  // the UI in `thinking` — see #startThinkingFallback.
  #thinkingFallbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: LiveKitAdapterOptions) {
    this.#mintToken = options.mintToken;
    this.#roomName = options.roomName;
    this.#logger = new Logger(options.debug ?? false, 'LiveKitAdapter');
    this.#thinkingFallbackMs = options.thinkingFallbackMs ?? THINKING_FALLBACK_MS;
  }

  /**
   * Explicit turn boundaries for this push-to-talk cascade. Unlike a
   * speech-native provider, the LiveKit STT→TTS pipeline has no server-side VAD
   * to derive turn edges from, so the hold-to-talk UI must delimit each turn:
   * `startTurn` unmutes the mic and drives the session into `listening`;
   * `endTurn` signals the worker to flush its STT buffer, mutes, and drives
   * `thinking`. These state emissions are load-bearing — with no VAD, this
   * control surface is the only thing that advances the sub-state machine.
   *
   * Surfaced as {@link AdapterTurnControl} (never touched by `RealtimeSession`)
   * so the binding/UI layer renders hold-to-talk controls off its presence.
   */
  readonly turnControl: AdapterTurnControl = {
    startTurn: async () => {
      const room = this.#room;
      if (!room) return;
      // A barge-in starts a new turn; cancel any pending empty-turn fallback so
      // it can't collapse the `listening` we're about to emit.
      this.#clearThinkingFallback();
      // Barging in while the assistant is mid-utterance: tell the worker to abort
      // the in-flight TTS so its audio stops near-instantly. A cancel-publish
      // failure is non-fatal — it must NOT block the user's turn, and nothing
      // downstream waits on the cancel. Raising a fatal RealtimeVoiceError would
      // tear the whole session down over a best-effort barge-in signal, so warn
      // once and unmute anyway; worst case the stale audio plays out. No collapse
      // is needed: the `listening` we emit below already releases `speaking`.
      if (this.#lastState === 'speaking') {
        // Invalidate the utterance being cancelled: its playout-end `tts_done`
        // will still arrive once the worker's clearQueue resolves, and must be
        // dropped as stale rather than clearing the empty-turn fallback below.
        this.#currentUtteranceId = undefined;
        const cancel: TtsCancelMessage = { type: 'tts_cancel' };
        try {
          await room.localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(cancel)),
            { reliable: true, topic: TURN_TOPIC },
          );
        } catch {
          const kind = 'tts_cancel';
          if (!this.#warnedNonFatalKinds.has(kind)) {
            this.#warnedNonFatalKinds.add(kind);
            this.#logger.warn(
              'Failed to signal TTS cancel to the LiveKit worker (non-fatal)',
            );
          }
        }
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        this.#emit({ type: 'error', error: this.#micEnableError(error) });
        return;
      }
      this.#emit({ type: 'speech_started' });
      this.#emit({ type: 'state', state: 'listening' });
    },
    endTurn: async () => {
      const room = this.#room;
      if (!room) return;
      // Mute first: it's local (no network), so a failed turn_end publish can't
      // leave the mic hot. Both a mute failure and a turn_end publish failure are
      // loss of the channel the session drives turns over (fatal): each emits a
      // RealtimeVoiceError and returns, because the session tears down on the
      // error — so publishing over the dead channel, or emitting `thinking` /
      // arming the fallback on a gone session, is dead work that would also
      // clobber the session's `error` state. Only a clean publish reaches
      // `thinking` + the empty-turn fallback below.
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch (error) {
        this.#emit({
          type: 'error',
          error: new RealtimeVoiceError(
            'CONNECTION_FAILED',
            'Failed to mute the microphone on turn end',
            error,
          ),
        });
        return;
      }
      const turnEnd: TurnEndMessage = { type: 'turn_end' };
      try {
        await room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify(turnEnd)),
          { reliable: true, topic: TURN_TOPIC },
        );
      } catch (error) {
        this.#emit({
          type: 'error',
          error: new RealtimeVoiceError(
            'DATA_CHANNEL_ERROR',
            'Failed to signal turn end to the LiveKit worker',
            error,
          ),
        });
        return;
      }
      this.#emit({ type: 'state', state: 'thinking' });
      this.#startThinkingFallback();
    },
  };

  /**
   * Joins the LiveKit room and wires the transcript/TTS relay.
   *
   * Phase-1 degeneracy: `opts.tools` and `opts.instructions` are intentionally
   * ignored. There is no LLM in the worker to configure — this adapter always
   * synthesizes a single `update_ui` tool call per transcript regardless of
   * the declared tool set. When a worker-side LLM lands, `tools`/`instructions`
   * become its session config (declared tools + system prompt), matching how
   * {@link RealtimeProviderAdapter}'s speech-native implementations consume
   * them today.
   */
  async connect(_opts: AdapterConnectOptions): Promise<void> {
    if (this.#room || this.#connecting) {
      throw new RealtimeVoiceError(
        'ALREADY_CONNECTED',
        'LiveKit adapter is already connected',
      );
    }
    this.#connecting = true;
    this.#emit({ type: 'state', state: 'connecting' });

    const attempt = this.#connectGuard.begin();
    const room = new Room();
    this.#room = room;
    this.#wireRoomEvents(room);

    try {
      let token: string;
      let url: string;
      try {
        ({ token, url } = await this.#mintToken(this.#roomName));
      } catch (error) {
        throw new RealtimeVoiceError(
          'TOKEN_MINT_FAILED',
          'Failed to mint a LiveKit token',
          error,
        );
      }
      // `disconnect()` clears `#room` synchronously, but an in-flight connect
      // keeps running against its local `room`. After every await, abort if a
      // disconnect (or a superseding connect) stole ownership — otherwise we'd
      // join and publish the mic on an orphaned room nobody can tear down.
      // A superseded attempt throws CONNECT_SUPERSEDED (never resolves as if it
      // connected), matching the OpenAI adapter.
      attempt.assertCurrent();
      await room.connect(url, token);
      attempt.assertCurrent();
      // Publish the mic track, then mute it via the SAME API turnControl uses.
      // Muting through setMicrophoneEnabled (not a direct track.mute()) keeps
      // the publication's enabled flag in sync, so startTurn's
      // setMicrophoneEnabled(true) is a real false→true toggle that actually
      // unmutes. A direct track.mute() leaves the publication "enabled", making
      // the later enable a silent no-op.
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        throw this.#micEnableError(error);
      }
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch (error) {
        throw this.#micEnableError(error);
      }
      attempt.assertCurrent();
    } catch (error) {
      // Snapshot currency BEFORE disconnecting: room.disconnect() fires its own
      // RoomEvent.Disconnected handler, which runs #teardown() and supersedes the
      // guard — so a post-disconnect isCurrent read would report even the sole
      // genuine attempt as superseded and skip the error emit. Decide from the
      // pre-disconnect view.
      const wasCurrent = attempt.isCurrent;
      // Always disconnect this attempt's own room — a later step may have thrown
      // after room.connect() succeeded, and a superseded attempt owns an
      // orphaned room nobody else will tear down.
      await room.disconnect().catch(() => {});
      if (wasCurrent) {
        // Still the current attempt — a genuine failure. Reset shared state and
        // surface the error. A superseded attempt skips this so it never
        // clobbers the winner's room or drives it into the error state.
        this.#teardown();
        this.#emit({ type: 'state', state: 'error' });
      }
      throw error;
    }

    this.#connecting = false;
    this.#emit({ type: 'state', state: 'connected' });
  }

  async disconnect(): Promise<void> {
    // Teardown must run even if room.disconnect() rejects — otherwise `#room`
    // stays set and every later connect() throws ALREADY_CONNECTED forever. The
    // rejection still propagates to the caller.
    this.#closing = true;
    try {
      await this.#room?.disconnect();
    } finally {
      this.#teardown();
    }
  }

  /**
   * Live mic and playback streams for UI metering. The mic is read from the
   * local microphone publication (published once on connect, then muted/unmuted
   * per turn — so it stays a stable stream across a hold); playback is the
   * worker's TTS track, captured when it is subscribed. Both are undefined
   * before connect and after disconnect. Never throws.
   */
  getAudioStreams(): AdapterAudioStreams {
    const micTrack = this.#room?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    const mic =
      micTrack?.mediaStream ??
      (micTrack ? new MediaStream([micTrack.mediaStreamTrack]) : undefined);
    return { mic, playback: this.#playbackStream };
  }

  /**
   * Relays a tool result back to the user as speech over the `speak` text
   * stream, where the worker synthesizes it via Cartesia and plays it into the
   * room. With no model in this cascaded pipeline the adapter picks the words
   * itself: for an `update_ui` result it voices the engine's `userMessage` when
   * present, else the structural `summary`; a read-only snapshot (get_ui_state /
   * get_capabilities) is serialized. Speak-after-render ordering is not this
   * adapter's concern — {@link RealtimeSession} only calls this once the render
   * has settled.
   *
   * Emits `speaking` on hand-off but does NOT collapse back here: the worker
   * publishes a `tts_done` packet on {@link TTS_TOPIC} when playout actually
   * finishes, and {@link collapseSpeaking} reacts to that — so the state tracks
   * real audio end, not text hand-off.
   *
   * Every failure here is **non-fatal** — the `update_ui` this reads back already
   * applied and nothing downstream waits on the spoken confirmation, so a failure
   * loses only the audio, never the session. Both failure paths therefore emit a
   * plain `Error` (logged, not session-fatal) rather than a `RealtimeVoiceError`,
   * and force the `speaking` collapse so the UI does not hang on audio that will
   * never play:
   * - **A send failure** (the room exists but `sendText` throws): matches the
   *   OpenAI adapter's parallel tool-result case — genuine connection loss is
   *   surfaced separately by the room's connection-state events, which own
   *   fatality.
   * - **No active room** (an intentional teardown raced this in-flight read-back):
   *   warns once, since a missing room here is a benign teardown race, not the
   *   connection loss the room's connection-state events would report.
   */
  async sendToolResult(callId: ToolCallId, output: ToolResult): Promise<void> {
    const speakText =
      'ok' in output
        ? (output.userMessage ?? output.summary ?? JSON.stringify(output))
        : JSON.stringify(output);
    this.#logger.debug('→ speak', { callId, speakText });
    const room = this.#room;
    if (!room) {
      // Non-fatal: the update_ui this reads back already applied, and nothing
      // downstream waits on the spoken confirmation. A missing room here means
      // an intentional teardown raced this in-flight result; genuine connection
      // loss is surfaced by the room's connection-state events, which own
      // fatality. Warn once (mirroring #handleTtsSignal) and collapse any
      // transient `speaking` rather than raising a fatal RealtimeVoiceError.
      const kind = 'no_room';
      if (!this.#warnedNonFatalKinds.has(kind)) {
        this.#warnedNonFatalKinds.add(kind);
        this.#logger.warn(
          'sendToolResult called with no active LiveKit room (non-fatal)',
          { callId },
        );
      }
      this.#collapseSpeaking();
      return;
    }
    this.#emit({ type: 'state', state: 'speaking' });
    // Stamp a fresh utterance id so the worker's playout status can be correlated
    // back to this specific utterance and stale status dropped.
    this.#utteranceSeq += 1;
    const utteranceId = this.#utteranceSeq;
    this.#currentUtteranceId = utteranceId;
    try {
      await room.localParticipant.sendText(speakText, {
        topic: SPEAK_TOPIC,
        attributes: { [SPEAK_UTTERANCE_ID_ATTR]: String(utteranceId) },
      });
    } catch (error) {
      // Non-fatal: a plain Error (RealtimeSession only logs these), never a
      // RealtimeVoiceError — the read-back already rendered, so only the spoken
      // confirmation is lost. Collapse the transient `speaking` so the UI does
      // not hang on audio that will never play.
      this.#emit({
        type: 'error',
        error: new Error('Failed to send speak text to the LiveKit worker', {
          cause: error,
        }),
      });
      this.#collapseSpeaking();
    }
  }

  /**
   * No-op in phase 1: grounding is ambient context injected into a model's
   * session, and there is no model in this cascaded pipeline to inject into.
   * It lands here (rather than being dropped by the session) only once a
   * worker-side LLM exists to receive it.
   */
  injectGrounding(_text: string): void {
    // Intentionally empty — see JSDoc.
  }

  on(handler: (event: RealtimeAdapterEvent) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /** Concrete-only: unlock audio playback after a user gesture. */
  async enableAudio(): Promise<void> {
    await this.#room?.startAudio();
  }

  #wireRoomEvents(room: Room): void {
    room.on(RoomEvent.Disconnected, () => {
      if (this.#room !== room) return;
      // Was this disconnect adapter-initiated? disconnect() sets `#closing`; a
      // connect() that fails and rolls back its own room does so while still
      // `#connecting`. Read before teardown clears both.
      const expected = this.#closing || this.#connecting;
      // Clear `#room` so a later connect() isn't rejected as 'already connected'
      // — without this, a server-side/network disconnect is unrecoverable.
      this.#teardown();
      if (expected) return;
      // An unexpected server/network drop is loss of the underlying connection
      // (fatal): emit a RealtimeVoiceError, NOT a bare `idle` state. The session's
      // `error` path then runs its cleanup (unsubscribing this adapter); a bare
      // `idle` state is a no-op there, leaving a stale subscription that would
      // double-handle every event after the next connect().
      this.#emit({
        type: 'error',
        error: new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'The LiveKit room disconnected unexpectedly',
        ),
      });
    });
    room.on(RoomEvent.TranscriptionReceived, (segments) => {
      this.#handleTranscription(segments);
    });
    // Publishing the worker's TTS track ≠ hearing it — attach it to a sink.
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      this.#attachAudioTrack(track);
    });
    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== TTS_TOPIC) return;
      this.#handleTtsSignal(payload);
    });
  }

  // Worker→client TTS status on TTS_TOPIC: a `tts_done` collapses `speaking`
  // (guarded, so a barge-in that already moved to `listening` isn't stomped).
  // A `tts_error` or malformed packet is non-fatal — the `update_ui` it was
  // reading back already rendered, so only the spoken confirmation was lost;
  // raising a RealtimeVoiceError would tear the whole session down over lost
  // audio. Warn once per distinct kind and collapse `speaking` so the UI does
  // not hang waiting for audio that will never arrive.
  #handleTtsSignal(payload: Uint8Array): void {
    let type: string | undefined;
    let utteranceId: number | undefined;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
        type?: string;
        utteranceId?: number;
      };
      type = parsed.type;
      utteranceId = parsed.utteranceId;
    } catch {
      type = undefined;
    }
    // Drop status for an utterance the client has already barged past: a
    // cancelled utterance's late `tts_done` must be a full no-op — not clear the
    // empty-turn fallback, not move state — or the UI wedges in `thinking`. Only
    // correlate when the packet actually carries an id; an id-less/malformed
    // packet can't be attributed, so it falls through to the non-fatal path.
    if (typeof utteranceId === 'number' && utteranceId !== this.#currentUtteranceId) {
      return;
    }
    // A live TTS signal means the worker is alive and driving state — the turn
    // was not empty, so cancel the empty-turn fallback.
    this.#clearThinkingFallback();
    if (type === 'tts_done') {
      this.#collapseSpeaking();
      return;
    }
    const kind = type ?? 'malformed';
    if (!this.#warnedNonFatalKinds.has(kind)) {
      this.#warnedNonFatalKinds.add(kind);
      this.#logger.warn('LiveKit worker TTS read-back failed (non-fatal)', {
        kind,
      });
    }
    this.#collapseSpeaking();
  }

  // Release the `speaking` state back to `connected` — but only if `speaking`
  // is still current. A push-to-talk barge-in emits `listening` while the
  // worker is still talking; collapsing unconditionally would stomp it.
  #collapseSpeaking(): void {
    if (this.#lastState === 'speaking') {
      this.#emit({ type: 'state', state: 'connected' });
    }
  }

  #handleTranscription(segments: TranscriptionSegment[]): void {
    const finals = segments.filter((s) => s.final);
    if (finals.length === 0) return;
    const text = finals
      .map((s) => s.text)
      .join(' ')
      .trim();
    if (!text) return;

    // The worker produced a transcript — the turn was not empty, so cancel the
    // empty-turn fallback before this drives a render.
    this.#clearThinkingFallback();
    this.#emit({ type: 'transcript', role: 'user', text, final: true });
    // The spike's core: a cascaded final transcript is turned into the same
    // `update_ui` tool call a speech-native model would emit, so RealtimeSession
    // drives it through the identical path (submitIntent → speak-after-render).
    this.#emit({
      type: 'tool_call',
      callId: this.#nextCallId(),
      name: 'update_ui',
      argumentsJson: JSON.stringify({ intent: text }),
    });
  }

  #nextCallId(): ToolCallId {
    this.#callSeq += 1;
    return ToolCallId(`livekit-${Date.now()}-${this.#callSeq}`);
  }

  #attachAudioTrack(track: RemoteTrack): void {
    this.#playbackStream =
      track.mediaStream ?? new MediaStream([track.mediaStreamTrack]);
    if (typeof document === 'undefined') return;
    if (!this.#audioEl) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.style.display = 'none';
      document.body.appendChild(el);
      this.#audioEl = el;
    }
    track.attach(this.#audioEl);
  }

  #emit(event: RealtimeAdapterEvent): void {
    if (event.type === 'state') this.#lastState = event.state;
    for (const handler of this.#handlers) handler(event);
  }

  // With no server-side VAD, an empty turn (accidental tap, no speech) yields no
  // worker response, so `thinking` would never resolve. Arm a one-shot timer to
  // collapse back to `connected`; it self-guards on `#lastState` so a barge-in
  // that already advanced state isn't stomped, and any real worker activity
  // cancels it via #clearThinkingFallback.
  #startThinkingFallback(): void {
    this.#clearThinkingFallback();
    if (this.#thinkingFallbackMs <= 0) return;
    this.#thinkingFallbackTimer = setTimeout(() => {
      this.#thinkingFallbackTimer = undefined;
      if (this.#lastState === 'thinking') {
        this.#emit({ type: 'state', state: 'connected' });
      }
    }, this.#thinkingFallbackMs);
  }

  #clearThinkingFallback(): void {
    if (this.#thinkingFallbackTimer !== undefined) {
      clearTimeout(this.#thinkingFallbackTimer);
      this.#thinkingFallbackTimer = undefined;
    }
  }

  // Maps a LiveKit mic-enable failure to its typed cause: a browser
  // getUserMedia permission denial (NotAllowedError / PermissionDeniedError)
  // gets its own code so the UI can offer permission help, versus a generic
  // device/transport failure.
  #micEnableError(cause: unknown): RealtimeVoiceError {
    const name = (cause as { name?: unknown } | null)?.name;
    return name === 'NotAllowedError' || name === 'PermissionDeniedError'
      ? new RealtimeVoiceError(
          'MIC_PERMISSION_DENIED',
          'Microphone permission was denied',
          cause,
        )
      : new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Failed to enable the microphone',
          cause,
        );
  }

  #teardown(): void {
    // Invalidate any connect() still mid-handshake so it abandons its own room
    // instead of clobbering shared state when its awaits resume.
    this.#connectGuard.supersede();
    this.#clearThinkingFallback();
    this.#warnedNonFatalKinds.clear();
    this.#room = undefined;
    this.#connecting = false;
    this.#closing = false;
    this.#currentUtteranceId = undefined;
    this.#playbackStream = undefined;
    if (this.#audioEl) {
      this.#audioEl.remove();
      this.#audioEl = undefined;
    }
  }
}

const THINKING_FALLBACK_MS = 10_000;
