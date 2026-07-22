import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { Logger } from '@maelstrom-co/client';
import { ToolCallId } from '@maelstrom-co/protocol';
import type {
  AdapterAudioStreams,
  AdapterAutomaticTurnControl,
  AdapterConnectOptions,
  AdapterTurnControl,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  ToolResult,
} from '@maelstrom-co/realtime';
import { ConnectRaceGuard, RealtimeVoiceError } from '@maelstrom-co/realtime';
import type {
  LocalAudioTrack,
  RemoteTrack,
  TranscriptionSegment,
} from 'livekit-client';
import { Room, RoomEvent, setLogLevel, Track } from 'livekit-client';

import type { LiveKitAdapterOptions } from './livekit-adapter.types.js';
import {
  createLocalAudioPreRoll,
  type LocalAudioPreRoll,
} from './local-audio-pre-roll.js';
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
 * LiveKit's WebRTC internals are exercised by live validation rather than unit
 * tests. Unit tests cover the adapter's mocked room orchestration, transcript →
 * tool-call synthesis, tool-result → speak-topic payload, and state mapping.
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
  // Client-side protection for the persistent remote TTS sink during a
  // barge-in. The worker cancellation is best-effort and may arrive after
  // already-buffered audio has started playing.
  #playbackMutedForBargeIn = false;
  // Keep one stopped-with-teardown raw clone for browser VAD and local pre-roll.
  // The generated publication is upstream-paused between automatic turns; on
  // unsupported browsers the native publication retains manual mute semantics.
  #micClone: MediaStreamTrack | undefined;
  #localAudioPreRoll: LocalAudioPreRoll | undefined;
  #automaticTurnControlAvailable = false;
  #micStream: MediaStream | undefined;
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
  #bargeInInProgress = false;
  // Turn boundaries share transport state, so an end requested while start is
  // awaiting cancellation or microphone setup must run after that start.
  #turnOperationQueue: Promise<void> = Promise.resolve();
  #lastQueuedTurnBoundary:
    | { generation: number; kind: 'start' | 'end'; result: Promise<void> }
    | undefined;
  #connectionGeneration = 0;

  constructor(options: LiveKitAdapterOptions) {
    this.#mintToken = options.mintToken;
    this.#roomName = options.roomName;
    this.#logger = new Logger(options.debug ?? false, 'LiveKitAdapter');
    this.#thinkingFallbackMs =
      options.thinkingFallbackMs ?? THINKING_FALLBACK_MS;
  }

  /**
   * Explicit turn boundaries for this push-to-talk cascade. Unlike a
   * speech-native provider, the LiveKit STT→TTS pipeline has no server-side VAD
   * to derive turn edges from, so the hold-to-talk UI must delimit each turn:
   * `startTurn` resumes upstream audio (or unmutes the native fallback) and
   * drives the session into `listening`; `endTurn` drains live audio, pauses or
   * mutes, signals the worker to flush STT, and drives `thinking`. These state
   * emissions are load-bearing — with no VAD, this
   * control surface is the only thing that advances the sub-state machine.
   *
   * Surfaced as {@link AdapterTurnControl} (never touched by `RealtimeSession`)
   * so the binding/UI layer renders hold-to-talk controls off its presence.
   */
  readonly turnControl: AdapterTurnControl = {
    startTurn: () =>
      this.#queueTurnBoundary('start', (generation) =>
        this.#startTransportTurn(generation, 'manual'),
      ),
    endTurn: () =>
      this.#queueTurnBoundary('end', (generation) =>
        this.#endTransportTurn(generation, 'manual'),
      ),
  };

  /**
   * Browser-VAD turn boundaries with adapter-owned bounded local pre-roll.
   * `isAvailable()` remains false when AudioWorklet setup failed, so bindings
   * select manual {@link turnControl} without transmitting an unbuffered turn.
   * `createHandle()` snapshots the current connection generation; every method
   * on a handle from a disconnected generation resolves without touching the
   * replacement room.
   */
  readonly automaticTurnControl: AdapterAutomaticTurnControl = {
    isAvailable: () => this.#automaticTurnControlAvailable,
    createHandle: () => {
      const generation = this.#connectionGeneration;
      return {
        startTurn: ({ preRollMs }) =>
          this.#queueTurnBoundary(
            'start',
            (boundGeneration) =>
              this.#startTransportTurn(boundGeneration, 'automatic', preRollMs),
            generation,
          ),
        endTurn: () =>
          this.#queueTurnBoundary(
            'end',
            (boundGeneration) =>
              this.#endTransportTurn(boundGeneration, 'automatic'),
            generation,
          ),
      };
    },
    startTurn: ({ preRollMs }) =>
      this.#queueTurnBoundary('start', (generation) =>
        this.#startTransportTurn(generation, 'automatic', preRollMs),
      ),
    endTurn: () =>
      this.#queueTurnBoundary('end', (generation) =>
        this.#endTransportTurn(generation, 'automatic'),
      ),
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
    this.#connectionGeneration += 1;
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
      // Capture once through LiveKit, then replace the publication with the
      // generated pre-roll track when AudioWorklet is available. Unsupported
      // browsers keep the native publication for manual hold-to-talk.
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (error) {
        throw this.#micEnableError(error);
      }
      await this.#initializeMicGeneration(room);
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
        await this.#teardown();
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
    const room = this.#room;
    const teardown = this.#teardown();
    try {
      await room?.disconnect();
    } finally {
      await teardown;
    }
  }

  /**
   * Live mic and playback streams for UI metering. The mic is read from the
   * enabled clone of the captured microphone. LiveKit pauses the generated
   * publication upstream between automatic turns, but this clone stays local
   * and enabled for browser VAD until teardown. Playback is the worker's TTS track, captured
   * when it is subscribed. Both are undefined before connect and after
   * disconnect. Never throws.
   */
  getAudioStreams(): AdapterAudioStreams {
    return { mic: this.#micStream, playback: this.#playbackStream };
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
   * Sending the spoken confirmation is best-effort because `update_ui` has already
   * applied and nothing downstream waits for this read-back. If no room is active,
   * an intentional teardown raced the result: the adapter warns once, collapses
   * any transient `speaking` state, and returns without emitting an adapter error.
   * If a room exists but `sendText` fails, the adapter emits a plain, non-fatal
   * `Error` (never a `RealtimeVoiceError`) and collapses `speaking`; genuine
   * connection loss is reported separately by the room's connection-state events.
   *
   * If a prior barge-in muted the persistent remote sink, this new
   * assistant-turn handoff is the only normal path that unmutes it. TTS
   * completion/error signals do not unmute playback because they may be stale.
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
    // Stamp a fresh utterance id so the worker's playout status can be correlated
    // back to this specific utterance and stale status dropped.
    this.#utteranceSeq += 1;
    const utteranceId = this.#utteranceSeq;
    this.#currentUtteranceId = utteranceId;
    // The worker owns one persistent audio track, so its next per-turn start
    // is this handoff rather than a new TrackSubscribed event.
    // This is deliberately distinct from stale tts_done/tts_error signals.
    this.#unmutePlaybackForNextTtsTurn();
    this.#emit({ type: 'state', state: 'speaking' });
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
      void this.#teardown();
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
    if (
      typeof utteranceId === 'number' &&
      utteranceId !== this.#currentUtteranceId
    ) {
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
    if (this.#playbackMutedForBargeIn) this.#audioEl.muted = true;
    track.attach(this.#audioEl);
  }

  /**
   * Latches a local playback mute synchronously for a barge-in, including when
   * the remote sink has not been attached yet. This uses `muted`, not `pause`,
   * so buffered stale TTS keeps advancing silently and cannot replay when
   * playback is later resumed.
   */
  #mutePlaybackForBargeIn(): void {
    this.#playbackMutedForBargeIn = true;
    if (this.#audioEl) this.#audioEl.muted = true;
  }

  /**
   * Restores playback after microphone setup fails before the new turn starts.
   * A failed mic enable means there is no active user turn to protect; the
   * next assistant handoff remains the other recovery path for a successful
   * barge-in.
   */
  #unmutePlaybackAfterFailedBargeIn(): void {
    if (this.#audioEl) this.#audioEl.muted = false;
    this.#playbackMutedForBargeIn = false;
  }

  /**
   * Releases a barge-in mute only when a new assistant TTS request is handed
   * to the worker. Ordinary state changes and stale completion signals do not
   * call this method.
   */
  #unmutePlaybackForNextTtsTurn(): void {
    if (!this.#playbackMutedForBargeIn) return;
    if (this.#audioEl) this.#audioEl.muted = false;
    this.#playbackMutedForBargeIn = false;
  }

  /**
   * Serializes turn boundaries so a requested end cannot be overtaken by an
   * already-started asynchronous start. Adjacent duplicate boundaries share
   * one operation; an intervening opposite boundary preserves the full order.
   * A rejected operation still releases the queue for the next boundary while
   * its own caller receives the error. Disconnect invalidates queued and
   * in-flight continuations, and a reconnect starts with an independent queue.
   */
  #queueTurnBoundary(
    kind: 'start' | 'end',
    operation: (generation: number) => Promise<void>,
    generation = this.#connectionGeneration,
  ): Promise<void> {
    if (
      this.#lastQueuedTurnBoundary?.kind === kind &&
      this.#lastQueuedTurnBoundary.generation === generation
    ) {
      return this.#lastQueuedTurnBoundary.result;
    }
    const result = this.#turnOperationQueue.then(() => {
      if (!this.#isCurrentGeneration(generation)) return;
      return operation(generation);
    });
    this.#turnOperationQueue = result.catch(() => {});
    const boundary = { generation, kind, result };
    this.#lastQueuedTurnBoundary = boundary;
    const clearBoundary = () => {
      if (this.#lastQueuedTurnBoundary === boundary) {
        this.#lastQueuedTurnBoundary = undefined;
      }
    };
    void result.then(clearBoundary, clearBoundary);
    return result;
  }

  /** Resumes upstream before selecting automatic pre-roll or manual live audio. */
  async #startTransportTurn(
    generation: number,
    mode: 'manual' | 'automatic',
    preRollMs = 0,
  ): Promise<void> {
    const room = this.#roomForGeneration(generation);
    if (!room) return;
    const bridge = this.#localAudioPreRoll;
    if (mode === 'automatic' && !bridge) {
      throw new Error('Automatic turn pre-roll is unavailable');
    }

    this.#clearThinkingFallback();
    const isBargeIn = this.#lastState === 'speaking';
    if (isBargeIn && this.#bargeInInProgress) return;
    if (isBargeIn) {
      this.#bargeInInProgress = true;
      this.#mutePlaybackForBargeIn();
      // The worker may still report completion after cancellation. Invalidate
      // this utterance before publishing so that late status is ignored.
      this.#currentUtteranceId = undefined;
      const cancel: TtsCancelMessage = { type: 'tts_cancel' };
      try {
        await room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify(cancel)),
          {
            reliable: true,
            topic: TURN_TOPIC,
          },
        );
      } catch {
        if (!this.#isCurrentRoom(generation, room)) return;
        const kind = 'tts_cancel';
        if (!this.#warnedNonFatalKinds.has(kind)) {
          this.#warnedNonFatalKinds.add(kind);
          this.#logger.warn(
            'Failed to signal TTS cancel to the LiveKit worker (non-fatal)',
          );
        }
      }
      if (!this.#isCurrentRoom(generation, room)) return;
    }

    try {
      if (bridge) {
        await this.#getPublishedMicTrack(room)?.resumeUpstream();
        if (!this.#isCurrentRoom(generation, room)) return;
        if (mode === 'automatic') await bridge.startAutomaticTurn(preRollMs);
        else await bridge.startManualTurn();
      } else {
        await room.localParticipant.setMicrophoneEnabled(true);
      }
      if (!this.#isCurrentRoom(generation, room)) return;
    } catch (error) {
      if (!this.#isCurrentRoom(generation, room)) return;
      const publishedMicTrack = this.#getPublishedMicTrack(room);
      if (bridge && publishedMicTrack) {
        try {
          await publishedMicTrack.pauseUpstream();
        } catch {}
      }
      if (isBargeIn) this.#unmutePlaybackAfterFailedBargeIn();
      this.#bargeInInProgress = false;
      if (mode === 'automatic') throw error;
      this.#emit({ type: 'error', error: this.#micEnableError(error) });
      return;
    }

    this.#bargeInInProgress = false;
    this.#emit({ type: 'speech_started' });
    this.#emit({ type: 'state', state: 'listening' });
  }

  /** Drains the active generation before upstream pause and STT finalization. */
  async #endTransportTurn(
    generation: number,
    mode: 'manual' | 'automatic',
  ): Promise<void> {
    const room = this.#roomForGeneration(generation);
    if (!room) return;
    const bridge = this.#localAudioPreRoll;
    if (mode === 'automatic' && !bridge) {
      throw new Error('Automatic turn pre-roll is unavailable');
    }

    let tailError: unknown;
    try {
      if (bridge) {
        try {
          await bridge.endTurn();
        } catch (error) {
          tailError = error;
        }
        if (!this.#isCurrentRoom(generation, room)) return;
        try {
          await this.#getPublishedMicTrack(room)?.pauseUpstream();
        } catch (error) {
          if (!this.#isCurrentRoom(generation, room)) return;
          if (mode === 'automatic') {
            this.#emit({
              type: 'error',
              error: new RealtimeVoiceError(
                'CONNECTION_FAILED',
                'Failed to pause microphone upstream on turn end',
                error,
              ),
            });
          }
          throw error;
        }
      } else {
        await room.localParticipant.setMicrophoneEnabled(false);
      }
      if (!this.#isCurrentRoom(generation, room)) return;
    } catch (error) {
      if (!this.#isCurrentRoom(generation, room)) return;
      if (mode === 'automatic') throw error;
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
        {
          reliable: true,
          topic: TURN_TOPIC,
        },
      );
    } catch (error) {
      if (!this.#isCurrentRoom(generation, room)) return;
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
    if (!this.#isCurrentRoom(generation, room)) return;
    this.#emit({ type: 'state', state: 'thinking' });
    this.#startThinkingFallback();
    if (tailError !== undefined) {
      if (mode === 'automatic') {
        throw Object.assign(
          new Error('Automatic turn finalized after local audio drain failed', {
            cause: tailError,
          }),
          { turnFinalized: true as const },
        );
      }
      this.#emit({ type: 'error', error: this.#micEnableError(tailError) });
    }
  }

  /**
   * Creates one raw local generation plus its generated LiveKit publication.
   * The raw publication is disabled and upstream-paused before asynchronous
   * bridge setup, while its enabled clone remains local for VAD and buffering.
   * Bridge ownership transfers before replacement awaits, allowing concurrent
   * teardown to destroy it. LiveKit 2.13.1 resumes upstream as a replacement
   * side effect, so the generated track stays disabled through replacement and
   * upstream is explicitly paused again before automatic control is available.
   * Success explicitly stops the old raw track; failure destroys the bridge and
   * raw track before connection teardown cleans the clone.
   */
  async #initializeMicGeneration(room: Room): Promise<void> {
    const micTrack = this.#getPublishedMicTrack(room);
    const mediaStreamTrack = micTrack?.mediaStreamTrack;
    if (!mediaStreamTrack || this.#micClone) return;

    mediaStreamTrack.enabled = false;
    await micTrack.pauseUpstream();
    const clone = mediaStreamTrack.clone();
    clone.enabled = true;
    this.#micClone = clone;
    this.#micStream = new MediaStream([clone]);
    let bridge: LocalAudioPreRoll;
    try {
      bridge = await createLocalAudioPreRoll(clone);
    } catch {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
        await micTrack.resumeUpstream();
      } catch (error) {
        throw this.#micEnableError(error);
      }
      return;
    }
    if (this.#room !== room) {
      mediaStreamTrack.enabled = false;
      mediaStreamTrack.stop();
      await bridge.destroy().catch(() => {});
      return;
    }

    // Ownership transfers before replacement awaits so concurrent teardown can
    // always disable and destroy the generated track.
    bridge.track.enabled = false;
    this.#localAudioPreRoll = bridge;
    try {
      await micTrack.replaceTrack(bridge.track, true);
      await micTrack.pauseUpstream();
    } catch (error) {
      mediaStreamTrack.enabled = false;
      mediaStreamTrack.stop();
      if (this.#localAudioPreRoll === bridge) {
        this.#localAudioPreRoll = undefined;
        await bridge.destroy().catch(() => {});
      }
      throw error;
    }
    if (this.#room === room && this.#localAudioPreRoll === bridge) {
      bridge.track.enabled = true;
      this.#automaticTurnControlAvailable = true;
    }
    mediaStreamTrack.enabled = false;
    mediaStreamTrack.stop();
  }

  /** Returns the room's current microphone publication as a local audio track. */
  #getPublishedMicTrack(room: Room): LocalAudioTrack | undefined {
    return room.localParticipant.getTrackPublication(Track.Source.Microphone)
      ?.track as LocalAudioTrack | undefined;
  }

  #isCurrentGeneration(generation: number): boolean {
    return generation === this.#connectionGeneration;
  }

  #roomForGeneration(generation: number): Room | undefined {
    return this.#isCurrentGeneration(generation) ? this.#room : undefined;
  }

  #isCurrentRoom(generation: number, room: Room): boolean {
    return this.#isCurrentGeneration(generation) && this.#room === room;
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

  #teardown(): Promise<void> {
    // Invalidate any connect() still mid-handshake so it abandons its own room
    // instead of clobbering shared state when its awaits resume.
    this.#connectGuard.supersede();
    this.#connectionGeneration += 1;
    this.#turnOperationQueue = Promise.resolve();
    this.#lastQueuedTurnBoundary = undefined;
    this.#clearThinkingFallback();
    this.#bargeInInProgress = false;
    this.#playbackMutedForBargeIn = false;
    this.#warnedNonFatalKinds.clear();
    const micClone = this.#micClone;
    const bridge = this.#localAudioPreRoll;
    this.#automaticTurnControlAvailable = false;
    this.#localAudioPreRoll = undefined;
    this.#micClone = undefined;
    this.#micStream = undefined;
    if (micClone) micClone.enabled = false;
    micClone?.stop();
    if (bridge) bridge.track.enabled = false;
    this.#room = undefined;
    this.#connecting = false;
    this.#closing = false;
    this.#currentUtteranceId = undefined;
    this.#playbackStream = undefined;
    if (this.#audioEl) {
      // Reset before removal so a retained element reference cannot stay muted
      // after teardown; the next connection creates a fresh sink.
      this.#audioEl.muted = false;
      this.#audioEl.remove();
      this.#audioEl = undefined;
    }
    return bridge ? bridge.destroy().catch(() => {}) : Promise.resolve();
  }
}

const THINKING_FALLBACK_MS = 10_000;
