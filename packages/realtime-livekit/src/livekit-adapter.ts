import type { Unsubscribe, VoiceSessionState } from '@maelstrom-co/client';
import { Logger } from '@maelstrom-co/client';
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
import type {
  TtsCancelMessage,
  TurnEndMessage,
} from '@maelstrom-co/realtime-protocol/livekit';
import {
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TTS_TOPIC,
  TURN_TOPIC,
} from '@maelstrom-co/realtime-protocol/livekit';
import type {
  LocalAudioTrack,
  RemoteTrack,
  TranscriptionSegment,
} from 'livekit-client';
import {
  createLocalAudioTrack,
  Room,
  RoomEvent,
  setLogLevel,
  Track,
} from 'livekit-client';

import {
  type BrowserVad,
  createBrowserVad,
  resolveBrowserVadConfig,
} from './browser-vad.js';
import type { LiveKitAdapterOptions } from './livekit-adapter.types.js';
import {
  createLocalAudioPreRoll,
  type LocalAudioPreRoll,
} from './local-audio-pre-roll.js';

/** Microphone resources acquired and owned by one asynchronous connect attempt. */
interface ConnectMicrophoneResources {
  /** LiveKit local track created and published for this attempt. */
  readonly micTrack: LocalAudioTrack;
  /** Native capture track replaced after the generated bridge is ready. */
  readonly rawMicTrack: MediaStreamTrack;
  /** Enabled browser-local clone retained for metering, VAD, and pre-roll. */
  readonly clone: MediaStreamTrack;
  /** Browser-local stream wrapping the enabled clone. */
  readonly stream: MediaStream;
}

/** Inputs that preserve the safety state of one automatic-mode degradation. */
interface AutomaticModeDegradationOptions {
  /** Connection generation whose automatic mode failed. */
  readonly generation: number;
  /** Failure reported when manual mode is established, or promoted if fatal. */
  readonly error: unknown;
  /** Whether an accepted automatic turn still requires closure. */
  readonly turnActive: boolean;
  /** Retires the VAD runtime associated with the failed generation. */
  readonly retireVad: () => Promise<void>;
  /** Whether the failing path already proved that upstream audio is paused. */
  readonly upstreamAlreadyPaused: boolean;
  /** Whether a failed pre-roll bridge must be replaced for manual turns. */
  readonly replaceFailedPreRoll: boolean;
}

/** Finisher inputs after the degrading generation's room has been resolved. */
interface FinishAutomaticModeDegradationOptions
  extends AutomaticModeDegradationOptions {
  /** LiveKit room owned by the degrading connection generation. */
  readonly room: Room;
}

// Quiet the livekit-client SDK's verbose signal/connection logging (which dumps
// the full connect URL on every join). Warnings and errors still surface.
setLogLevel('warn');

const SAFELY_PAUSED_MISFIRE_CANCELLATION = Symbol(
  'safely-paused-misfire-cancellation',
);

/**
 * A {@link RealtimeProviderAdapter} backed by a LiveKit cascaded STT/TTS
 * pipeline instead of a speech-native realtime model. It joins a LiveKit room,
 * publishes an upstream-gated mic, and synthesizes an `update_ui` tool call
 * from each final user transcript so a
 * cascaded pipeline drives the exact same {@link RealtimeSession} machinery
 * (speak-after-render, barge-in, sidechannel events) as the OpenAI realtime
 * adapter. The companion worker has no LLM and receives no UI grounding. The
 * synthesized intent still reaches the Maelstrom Engine, which remains the
 * planning LLM.
 *
 * Browser VAD is automatic by default. Idle microphone audio remains local;
 * the upstream publication opens only for an accepted turn and is paused again
 * before that turn ends. `vad: false` selects intentional manual control
 * without loading VAD assets. Invalid configuration and VAD setup or callback
 * failures degrade a still-usable connection to manual mode only after upstream
 * audio is safely paused. Transport failures remain fatal and never advertise
 * manual fallback. Manual controls are therefore dynamic and available only
 * while the adapter has established manual mode.
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
 * // Automatic mode is ready; use `vad: false` when the UI needs hold-to-talk.
 * ```
 */
export class LiveKitAdapter implements RealtimeProviderAdapter {
  readonly #mintToken: LiveKitAdapterOptions['mintToken'];
  readonly #roomName: string;
  readonly #logger: Logger;
  readonly #handlers = new Set<(event: RealtimeAdapterEvent) => void>();
  readonly #vadConfig: ReturnType<typeof resolveBrowserVadConfig> | undefined;
  readonly #vadConfigError: unknown;

  #room: Room | undefined;
  #audioEl: HTMLAudioElement | undefined;
  // Client-side protection for the persistent remote TTS sink during a
  // barge-in. The worker cancellation is best-effort and may arrive after
  // already-buffered audio has started playing.
  #playbackMutedForBargeIn = false;
  // Keep one teardown-owned local clone for browser VAD and pre-roll. Runtime
  // degradation retires it after native manual capture replaces the bridge.
  // The generated publication is upstream-paused between automatic turns; on
  // unsupported browsers the native publication retains manual mute semantics.
  #micClone: MediaStreamTrack | undefined;
  #rawMicTrack: MediaStreamTrack | undefined;
  #localAudioPreRoll: LocalAudioPreRoll | undefined;
  #browserVad: BrowserVad | undefined;
  #manualTurnControlAvailable = false;
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
  // The utterance whose TTS status the client currently accepts. Set before a
  // speak handoff and retained while its worker response is outstanding; cleared
  // when that handoff fails, an accepted terminal status arrives, or a barge-in
  // invalidates it. Keeping unrelated status from clearing this id fences stale
  // worker packets from newer turns.
  #currentUtteranceId: number | undefined;
  // Rescues an empty push-to-talk turn (no speech) that would otherwise wedge
  // the UI in `thinking` — see #startThinkingFallback.
  #thinkingFallbackTimer: ReturnType<typeof setTimeout> | undefined;
  #bargeInInProgress = false;
  // Turn boundaries share transport state, so an end requested while start is
  // awaiting cancellation or microphone setup must run after that start.
  #turnOperationQueue: Promise<void> = Promise.resolve();
  #lastQueuedTurnBoundary:
    | {
        generation: number;
        kind: 'start' | 'end' | 'cancel';
        result: Promise<void>;
      }
    | undefined;
  #connectionGeneration = 0;
  #automaticModeDegradation:
    | { readonly generation: number; readonly result: Promise<void> }
    | undefined;

  /**
   * Creates a disconnected adapter. VAD configuration is validated eagerly but
   * retained as a diagnostic setup failure rather than thrown; `connect()` can
   * then establish safely paused manual mode. No room, microphone, VAD runtime,
   * worklet, or network resource is created until `connect()`.
   */
  constructor(options: LiveKitAdapterOptions) {
    this.#mintToken = options.mintToken;
    this.#roomName = options.roomName;
    this.#logger = new Logger(options.debug ?? false, 'LiveKitAdapter');
    this.#thinkingFallbackMs =
      options.thinkingFallbackMs ?? THINKING_FALLBACK_MS;
    try {
      this.#vadConfig = resolveBrowserVadConfig(options.vad);
      this.#vadConfigError = undefined;
    } catch (error) {
      this.#vadConfig = undefined;
      this.#vadConfigError = error;
    }
  }

  /**
   * Explicit boundaries for a connection that established manual mode. Unlike
   * a speech-native provider, the LiveKit STT→TTS pipeline has no server-side
   * VAD to derive turn edges from, so the hold-to-talk UI delimits each turn:
   * `startTurn` resumes upstream audio before unmuting native capture or emitting
   * generated audio and drives the session into `listening`. `endTurn` mutes
   * native capture or drains the generated tail, pauses upstream, signals the
   * worker to flush STT, and drives `thinking`. A bounded local-tail drain
   * failure is warning-only once pause and `turn_end` finalize the manual turn;
   * pause and signaling failures remain fatal. These state emissions are
   * load-bearing — with no VAD, this control surface is the only thing that
   * advances the sub-state machine.
   *
   * Surfaced as {@link AdapterTurnControl} (never touched by `RealtimeSession`)
   * so the binding/UI layer renders hold-to-talk controls off its presence.
   */
  readonly #manualTurnControl: AdapterTurnControl = {
    startTurn: () =>
      this.#queueTurnBoundary('start', (generation) =>
        this.#startTransportTurn(generation, 'manual'),
      ),
    endTurn: () =>
      this.#queueTurnBoundary('end', (generation) =>
        this.#endTransportTurn(generation, 'manual'),
      ),
  };

  /** Present only after this connection safely establishes manual turns. */
  get turnControl(): AdapterTurnControl | undefined {
    return this.#manualTurnControlAvailable
      ? this.#manualTurnControl
      : undefined;
  }

  /**
   * Joins the LiveKit room and wires the transcript/TTS relay.
   *
   * Microphone capture is acquired locally, cloned for metering/VAD, and muted
   * before publication. This deliberately avoids `setMicrophoneEnabled(true)`,
   * which publishes an enabled track before the adapter can apply its upstream
   * gate. The connection does not expose automatic or manual turn mode until
   * the published track is upstream-paused. Capture, clone, mute, publication,
   * or pause failures are fatal and release all acquired local tracks.
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
    const generation = this.#connectionGeneration;
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
      // Capture locally so the raw microphone can be disabled before its first
      // publication. The enabled clone remains browser-local for metering, VAD,
      // and pre-roll while the publication starts muted and upstream-paused.
      let microphone: ConnectMicrophoneResources;
      try {
        const micTrack = await createLocalAudioTrack();
        if (!attempt.isCurrent) micTrack.stop();
        attempt.assertCurrent();
        const rawMicTrack = micTrack.mediaStreamTrack;
        const clone = rawMicTrack.clone();
        clone.enabled = true;
        const stream = new MediaStream([clone]);
        microphone = { micTrack, rawMicTrack, clone, stream };
        this.#rawMicTrack = rawMicTrack;
        this.#micClone = clone;
        this.#micStream = stream;
        await micTrack.mute();
        attempt.assertCurrent();
        await room.localParticipant.publishTrack(micTrack);
        attempt.assertCurrent();
        await micTrack.pauseUpstream();
        attempt.assertCurrent();
      } catch (error) {
        if (error instanceof RealtimeVoiceError) throw error;
        throw this.#micEnableError(error);
      }
      if (this.#vadConfig?.enabled) {
        const vadError = await this.#initializeMicGeneration(
          room,
          generation,
          microphone,
        );
        attempt.assertCurrent();
        if (vadError === undefined) {
          const browserVadError = await this.#initializeBrowserVad(
            generation,
            microphone.stream,
          );
          attempt.assertCurrent();
          if (browserVadError === undefined) {
            this.#emit({ type: 'turn_mode', mode: 'automatic' });
          } else {
            await this.#degradeAutomaticMode({
              generation,
              error: browserVadError,
              turnActive: false,
              retireVad: async () => {},
              upstreamAlreadyPaused: false,
              replaceFailedPreRoll: false,
            });
          }
        } else {
          await this.#degradeAutomaticMode({
            generation,
            error: vadError,
            turnActive: false,
            retireVad: async () => {},
            upstreamAlreadyPaused: false,
            replaceFailedPreRoll: false,
          });
        }
      } else {
        await this.#initializeManualMic(room);
        attempt.assertCurrent();
        this.#establishManualMode(this.#vadConfigError);
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
   * room. The companion worker has no LLM and receives no UI grounding, so the
   * adapter picks the words itself: for an `update_ui` result it voices the
   * engine's `userMessage` when present, else the structural `summary`; a
   * read-only snapshot (get_ui_state / get_capabilities) is serialized. The
   * Maelstrom Engine remains the planning LLM. Speak-after-render ordering is
   * not this adapter's concern — {@link RealtimeSession} only calls this once
   * the render has settled.
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
   * `Error` (never a `RealtimeVoiceError`). If the failed handoff is still
   * current, the adapter discards it and collapses `speaking`. A concurrent newer
   * handoff stays outstanding and keeps its active state; genuine connection
   * loss is reported separately by the room's connection-state events.
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
    this.#logger.debug('→ speak', {
      callId,
      resultKind: 'ok' in output ? 'update_ui' : 'read_only',
    });
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
      if (this.#currentUtteranceId === utteranceId) {
        this.#currentUtteranceId = undefined;
        this.#collapseSpeaking();
      }
    }
  }

  /**
   * No-op in phase 1: the companion worker has no LLM and receives no UI
   * grounding. The Maelstrom Engine remains the planning LLM, but receives its
   * request-embedded planning context through the normal intent path rather
   * than this provider hook. The worker's STT and TTS models continue to handle
   * transcription and synthesis without consuming grounding. This hook becomes
   * active only if a worker-side LLM is added to receive it.
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

  // Worker→client TTS status on TTS_TOPIC: an accepted terminal status clears the
  // outstanding utterance, and `tts_done` collapses `speaking` (guarded, so a
  // barge-in that already moved to `listening` isn't stomped). An accepted
  // `tts_error` or malformed packet is non-fatal — the `update_ui` it was reading
  // back already rendered, so only the spoken confirmation was lost; raising a
  // RealtimeVoiceError would tear the whole session down over lost audio. Warn
  // once per distinct kind and collapse `speaking` so the UI does not hang
  // waiting for audio that will never arrive.
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
    // correlate when the packet actually carries an id. Legacy id-less terminal
    // status is accepted only while an utterance remains outstanding below.
    if (
      typeof utteranceId === 'number' &&
      utteranceId !== this.#currentUtteranceId
    ) {
      return;
    }
    const isTerminal = type === 'tts_done' || type === 'tts_error';
    // Older workers omit utteranceId. Preserve compatibility only while a worker
    // response is outstanding; after barge-in invalidates that response, a late
    // id-less terminal packet is indistinguishable from stale and must be ignored.
    if (
      isTerminal &&
      utteranceId === undefined &&
      this.#currentUtteranceId === undefined
    ) {
      return;
    }
    if (isTerminal) {
      this.#currentUtteranceId = undefined;
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
   * Serializes start, real end, and misfire-cancel boundaries so none can
   * overtake an already-started asynchronous operation. Adjacent duplicate
   * boundaries share one operation; an intervening distinct boundary preserves
   * the full order. A rejected operation still releases the queue for the next
   * boundary while its own caller receives the error. Disconnect invalidates
   * queued and in-flight continuations, and a reconnect starts with an
   * independent queue, making stale callbacks no-ops.
   */
  #queueTurnBoundary(
    kind: 'start' | 'end' | 'cancel',
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

  /**
   * Resumes upstream before selecting automatic pre-roll or manual live audio.
   * Automatic ordering is load-bearing: the generated track must be live before
   * the bridge emits buffered samples, or the utterance prefix is dropped.
   * Starting over an outstanding assistant utterance first invalidates and
   * cancels it. Playback is muted only when that utterance is already speaking;
   * a pending response in `thinking` has no active audio to mute. Cancellation
   * publication is reliable but best-effort: failure warns once without blocking
   * the new turn, and invalidation still fences late status for the old utterance.
   */
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
    const shouldMutePlayback = this.#lastState === 'speaking';
    const isBargeIn =
      shouldMutePlayback ||
      (this.#lastState === 'thinking' &&
        this.#currentUtteranceId !== undefined);
    if (isBargeIn && this.#bargeInInProgress) return;
    if (isBargeIn) {
      this.#bargeInInProgress = true;
      if (shouldMutePlayback) this.#mutePlaybackForBargeIn();
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
      try {
        await this.#getPublishedMicTrack(room)?.resumeUpstream();
      } catch (cause) {
        throw new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Failed to resume microphone upstream',
          cause,
        );
      }
      if (!this.#isCurrentRoom(generation, room)) return;
      if (bridge) {
        if (mode === 'automatic') await bridge.startAutomaticTurn(preRollMs);
        else await bridge.startManualTurn();
      } else {
        await room.localParticipant.setMicrophoneEnabled(true);
      }
      if (!this.#isCurrentRoom(generation, room)) return;
    } catch (error) {
      if (!this.#isCurrentRoom(generation, room)) return;
      let turnStartError = error;
      const publishedMicTrack = this.#getPublishedMicTrack(room);
      if (publishedMicTrack) {
        try {
          await publishedMicTrack.pauseUpstream();
        } catch (cause) {
          turnStartError = new RealtimeVoiceError(
            'CONNECTION_FAILED',
            'Failed to pause microphone after turn start failed',
            cause,
          );
        }
      }
      if (shouldMutePlayback) this.#unmutePlaybackAfterFailedBargeIn();
      this.#bargeInInProgress = false;
      if (mode === 'automatic') throw turnStartError;
      const fatalError =
        turnStartError instanceof RealtimeVoiceError
          ? turnStartError
          : this.#micEnableError(turnStartError);
      await this.#failTransport(generation, room, fatalError);
      return;
    }

    this.#bargeInInProgress = false;
    this.#emit({ type: 'speech_started' });
    this.#emit({ type: 'state', state: 'listening' });
  }

  /**
   * Mutes native audio or drains the generated tail, then pauses upstream and
   * reliably signals `turn_end`. A drain rejection is deferred until the turn
   * is finalized: automatic mode rethrows it for manual degradation, while an
   * already-manual turn warns and remains usable. A missing publication, pause
   * rejection, or signaling failure is fatal because safe upstream closure is
   * no longer proven. Stale rooms remain no-ops around every await.
   */
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
      } else {
        await room.localParticipant.setMicrophoneEnabled(false);
      }
      if (!this.#isCurrentRoom(generation, room)) return;
    } catch (error) {
      if (!this.#isCurrentRoom(generation, room)) return;
      const fatalError =
        error instanceof RealtimeVoiceError
          ? error
          : new RealtimeVoiceError(
              'CONNECTION_FAILED',
              'Failed to mute the microphone on turn end',
              error,
            );
      await this.#failTransport(generation, room, fatalError);
      return;
    }

    const publishedMicTrack = this.#getPublishedMicTrack(room);
    if (!publishedMicTrack) {
      await this.#failTransport(
        generation,
        room,
        new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Published microphone track disappeared on turn end',
        ),
      );
      return;
    }
    try {
      await publishedMicTrack.pauseUpstream();
    } catch (error) {
      if (!this.#isCurrentRoom(generation, room)) return;
      await this.#failTransport(
        generation,
        room,
        new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Failed to pause microphone upstream on turn end',
          error,
        ),
      );
      return;
    }
    if (!this.#isCurrentRoom(generation, room)) return;

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
      await this.#failTransport(
        generation,
        room,
        new RealtimeVoiceError(
          'DATA_CHANNEL_ERROR',
          'Failed to signal turn end to the LiveKit worker',
          error,
        ),
      );
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
      const kind = 'manual_audio_drain';
      if (!this.#warnedNonFatalKinds.has(kind)) {
        this.#warnedNonFatalKinds.add(kind);
        this.#logger.warn(
          'Manual turn finalized after local audio drain failed (non-fatal)',
        );
      }
    }
  }

  /**
   * Cancels a VAD misfire without committing a provider turn. Unlike a real
   * speech end, cancellation only drains the local generation, pauses upstream,
   * and returns the current automatic connection to idle: it never publishes
   * `turn_end`, enters `thinking`, or arms the thinking fallback. A stale room or
   * generation is a no-op before and after every await. If local drain is
   * uncertain after upstream is safely paused, the connection first returns to
   * idle, then the marked failure retires VAD and degrades to manual mode. A
   * missing publication or rejected pause cannot prove upstream silence and is
   * therefore fatal rather than a manual fallback.
   */
  async #cancelTransportTurn(generation: number): Promise<void> {
    const room = this.#roomForGeneration(generation);
    if (!room) return;
    const bridge = this.#localAudioPreRoll;
    if (!bridge) throw new Error('Automatic turn pre-roll is unavailable');

    let drainError: unknown;
    try {
      await bridge.endTurn();
    } catch (error) {
      drainError = error;
    }
    if (!this.#isCurrentRoom(generation, room)) return;

    const publishedMicTrack = this.#getPublishedMicTrack(room);
    if (!publishedMicTrack) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Published microphone track disappeared while cancelling a VAD misfire',
      );
    }
    try {
      await publishedMicTrack.pauseUpstream();
    } catch (cause) {
      if (!this.#isCurrentRoom(generation, room)) return;
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to pause microphone upstream while cancelling a VAD misfire',
        cause,
      );
    }
    if (!this.#isCurrentRoom(generation, room)) return;

    this.#clearThinkingFallback();
    this.#bargeInInProgress = false;
    this.#emit({ type: 'state', state: 'connected' });
    if (drainError !== undefined) {
      throw Object.assign(
        new Error('VAD misfire cancelled after local audio drain failed', {
          cause: drainError,
        }),
        { [SAFELY_PAUSED_MISFIRE_CANCELLATION]: true as const },
      );
    }
  }

  /**
   * Creates one raw local generation plus its generated LiveKit publication.
   * Capture, clone, stream, and publication references come from this connect
   * attempt rather than mutable adapter fields, so a superseded continuation
   * can only inspect or release resources that belonged to its own attempt.
   * The raw publication is disabled and upstream-paused before asynchronous
   * bridge setup, while its enabled clone remains local for VAD and buffering.
   * Bridge ownership transfers before replacement awaits, allowing concurrent
   * teardown to destroy it. A continuation revalidates its room, generation,
   * and bridge ownership around each publication mutation; if unmute finishes
   * after ownership is lost, it disables the stale generated track again and
   * aborts without mutating replacement resources or exposing stale turn mode.
   * LiveKit may resume upstream as a replacement side effect, so the
   * generated track stays disabled through replacement and upstream is explicitly
   * paused again before the replacement is unmuted and automatic or
   * degraded-manual control becomes available. Unmuting while the sender is
   * paused clears LiveKit's persistent logical mute without sending idle audio.
   * Success explicitly stops the old raw track; failure destroys the bridge and
   * raw track before connection teardown cleans the clone.
   */
  async #initializeMicGeneration(
    room: Room,
    generation: number,
    microphone: ConnectMicrophoneResources,
  ): Promise<unknown | undefined> {
    const { micTrack, rawMicTrack: mediaStreamTrack, clone } = microphone;
    let bridge: LocalAudioPreRoll;
    try {
      bridge = await createLocalAudioPreRoll(clone);
    } catch (error) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
        await micTrack.resumeUpstream();
      } catch (error) {
        throw this.#micEnableError(error);
      }
      return error;
    }
    if (this.#room !== room) {
      mediaStreamTrack.enabled = false;
      mediaStreamTrack.stop();
      await bridge.destroy().catch(() => {});
      return undefined;
    }

    // Ownership transfers before replacement awaits so concurrent teardown can
    // always disable and destroy the generated track.
    bridge.track.enabled = false;
    this.#localAudioPreRoll = bridge;
    try {
      await micTrack.replaceTrack(bridge.track, true);
      if (
        !this.#isCurrentRoom(generation, room) ||
        this.#localAudioPreRoll !== bridge
      ) {
        return undefined;
      }
      await micTrack.pauseUpstream();
      if (
        !this.#isCurrentRoom(generation, room) ||
        this.#localAudioPreRoll !== bridge
      ) {
        return undefined;
      }
      await micTrack.unmute();
      if (
        !this.#isCurrentRoom(generation, room) ||
        this.#localAudioPreRoll !== bridge
      ) {
        bridge.track.enabled = false;
        return undefined;
      }
    } catch (error) {
      mediaStreamTrack.enabled = false;
      mediaStreamTrack.stop();
      if (this.#rawMicTrack === mediaStreamTrack) {
        this.#rawMicTrack = undefined;
      }
      if (this.#localAudioPreRoll === bridge) {
        this.#localAudioPreRoll = undefined;
        await bridge.destroy().catch(() => {});
      }
      throw error;
    }
    if (this.#room === room && this.#localAudioPreRoll === bridge) {
      bridge.track.enabled = true;
    }
    mediaStreamTrack.enabled = false;
    mediaStreamTrack.stop();
    if (this.#rawMicTrack === mediaStreamTrack) {
      this.#rawMicTrack = undefined;
    }
    return undefined;
  }

  /**
   * Establishes manual capture without creating VAD resources. The publication
   * remains upstream-paused and muted until `turnControl.startTurn()` enables it.
   */
  async #initializeManualMic(room: Room): Promise<void> {
    await room.localParticipant.setMicrophoneEnabled(false);
  }

  /**
   * Loads and starts one VAD instance for the current microphone generation.
   * The connection does not advertise automatic mode until start succeeds. A
   * superseded initialization destroys its own VAD instead of attaching it to
   * the replacement connection; setup failures remain non-fatal and select the
   * existing manual path. Runtime failure wiring recognizes a misfire that has
   * already proved upstream pause, avoiding duplicate pause or provider commit
   * while still retiring VAD and exposing diagnostic manual mode.
   */
  async #initializeBrowserVad(
    generation: number,
    stream: MediaStream,
  ): Promise<unknown | undefined> {
    const config = this.#vadConfig;
    if (!config?.enabled) {
      return new Error('Automatic VAD requires a local microphone stream');
    }

    let browserVad: BrowserVad;
    try {
      browserVad = await createBrowserVad({
        stream,
        config,
        startTurn: () =>
          this.#queueTurnBoundary(
            'start',
            (currentGeneration) =>
              this.#startTransportTurn(
                currentGeneration,
                'automatic',
                config.preRollMs,
              ),
            generation,
          ),
        endTurn: () =>
          this.#queueTurnBoundary(
            'end',
            (currentGeneration) =>
              this.#endTransportTurn(currentGeneration, 'automatic'),
            generation,
          ),
        cancelTurn: () =>
          this.#queueTurnBoundary(
            'cancel',
            (currentGeneration) => this.#cancelTransportTurn(currentGeneration),
            generation,
          ),
        onFailure: (error, context) => {
          const safelyPausedMisfire = isSafelyPausedMisfireCancellation(error);
          return this.#degradeAutomaticMode({
            generation,
            error,
            turnActive: safelyPausedMisfire ? false : context.turnActive,
            retireVad: context.retire,
            upstreamAlreadyPaused: safelyPausedMisfire,
            replaceFailedPreRoll: true,
          });
        },
      });
    } catch (error) {
      return error;
    }

    if (!this.#isCurrentGeneration(generation)) {
      await browserVad.destroy();
      return undefined;
    }
    this.#browserVad = browserVad;
    return undefined;
  }

  /**
   * Retires automatic transmission after setup or a VAD callback fails. Manual
   * controls become observable only after upstream is paused; inability to
   * pause is a fatal transport error rather than a false manual fallback. A
   * safely paused misfire skips duplicate turn closure, but runtime callback
   * failures still replace the failed bridge behind a fresh pause proof before
   * publishing diagnostic manual mode. An active automatic turn is handed off
   * for closure before VAD retirement. Concurrent finalizers for one generation
   * share the same result.
   */
  async #degradeAutomaticMode(
    options: AutomaticModeDegradationOptions,
  ): Promise<void> {
    const { generation } = options;
    const room = this.#roomForGeneration(generation);
    if (!room || this.#manualTurnControlAvailable) return;
    if (this.#automaticModeDegradation?.generation === generation) {
      return this.#automaticModeDegradation.result;
    }
    const result = this.#finishAutomaticModeDegradation({
      ...options,
      room,
    });
    const degradation = { generation, result };
    this.#automaticModeDegradation = degradation;
    try {
      await result;
    } finally {
      if (this.#automaticModeDegradation === degradation) {
        this.#automaticModeDegradation = undefined;
      }
    }
  }

  /**
   * Closes or proves-paused transport, replaces a bridge implicated in a runtime
   * callback failure with disabled native capture, retires VAD, then publishes
   * its mode. Setup failures may retain a healthy bridge for manual turns.
   * Missing resources and rejected safety operations are fatal; stale rooms
   * return without advertising manual success.
   */
  async #finishAutomaticModeDegradation(
    options: FinishAutomaticModeDegradationOptions,
  ): Promise<void> {
    const {
      generation,
      room,
      error,
      turnActive,
      retireVad,
      upstreamAlreadyPaused,
      replaceFailedPreRoll,
    } = options;
    if (error instanceof RealtimeVoiceError) {
      await retireVad();
      await this.#failTransport(generation, room, error);
      throw error;
    }
    if (turnActive) {
      try {
        await this.#endTransportTurn(generation, 'automatic');
      } catch (cause) {
        const finalized =
          typeof cause === 'object' &&
          cause !== null &&
          'turnFinalized' in cause &&
          cause.turnFinalized === true;
        if (!finalized) {
          await retireVad();
          if (!this.#isCurrentRoom(generation, room)) return;
          const fatalError = new RealtimeVoiceError(
            'CONNECTION_FAILED',
            'Failed to close the active automatic turn during VAD degradation',
            cause,
          );
          await this.#failTransport(generation, room, fatalError);
          throw fatalError;
        }
      }
    }

    if (replaceFailedPreRoll) {
      try {
        await this.#replaceFailedPreRollWithManualTrack(generation, room);
      } catch (cause) {
        await retireVad().catch(() => {});
        if (!this.#isCurrentRoom(generation, room)) return;
        const fatalError =
          cause instanceof RealtimeVoiceError
            ? cause
            : new RealtimeVoiceError(
                'CONNECTION_FAILED',
                'Failed to replace automatic pre-roll with manual microphone capture',
                cause,
              );
        await this.#failTransport(generation, room, fatalError);
        throw fatalError;
      }
    } else if (!turnActive && !upstreamAlreadyPaused) {
      if (!this.#isCurrentRoom(generation, room)) return;
      const publishedMicTrack = this.#getPublishedMicTrack(room);
      if (!publishedMicTrack) {
        const fatalError = new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Published microphone track disappeared while leaving automatic turn mode',
        );
        await retireVad();
        await this.#failTransport(generation, room, fatalError);
        throw fatalError;
      }
      try {
        await publishedMicTrack.pauseUpstream();
      } catch (cause) {
        if (!this.#isCurrentRoom(generation, room)) return;
        const fatalError = new RealtimeVoiceError(
          'CONNECTION_FAILED',
          'Failed to pause microphone while leaving automatic turn mode',
          cause,
        );
        await retireVad();
        await this.#failTransport(generation, room, fatalError);
        throw fatalError;
      }
    }
    await retireVad();
    if (this.#isCurrentRoom(generation, room)) {
      this.#establishManualMode(error);
    }
  }

  /**
   * Replaces a failed generated pre-roll publication with a native clone while
   * preserving zero idle transmission. Pause and logical mute are proved before
   * replacement; the disabled replacement is paused again immediately because
   * LiveKit can resume its sender while swapping tracks. The failed bridge is
   * destroyed before manual controls become observable. The obsolete VAD clone
   * is then stopped exactly once and metering moves to the active native manual
   * track without duplicating teardown ownership. Any uncertain step is a
   * transport failure, and stale generations never publish manual capability or
   * retire resources belonging to a successor connection.
   */
  async #replaceFailedPreRollWithManualTrack(
    generation: number,
    room: Room,
  ): Promise<void> {
    const bridge = this.#localAudioPreRoll;
    const publishedMicTrack = this.#getPublishedMicTrack(room);
    const localMicClone = this.#micClone;
    if (!bridge || !publishedMicTrack || !localMicClone) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Automatic pre-roll resources disappeared during manual degradation',
      );
    }

    try {
      await publishedMicTrack.pauseUpstream();
      if (!this.#isCurrentRoom(generation, room)) return;
      await publishedMicTrack.mute();
      if (!this.#isCurrentRoom(generation, room)) return;
    } catch (cause) {
      if (!this.#isCurrentRoom(generation, room)) return;
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to silence automatic pre-roll before manual degradation',
        cause,
      );
    }

    let replacement: MediaStreamTrack;
    try {
      replacement = localMicClone.clone();
      replacement.enabled = false;
    } catch (cause) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to create native microphone capture for manual degradation',
        cause,
      );
    }
    if (!this.#isCurrentRoom(generation, room)) {
      replacement.stop();
      return;
    }

    // Transfer teardown ownership before the replacement await. If disconnect
    // wins that race, teardown disables and stops the native track immediately.
    this.#rawMicTrack = replacement;
    try {
      await publishedMicTrack.replaceTrack(replacement, {
        userProvidedTrack: true,
        stopProcessor: true,
      });
      // Do not revalidate before this pause: replaceTrack may have resumed the
      // old room's sender, so even a stale generation must close it first.
      await publishedMicTrack.pauseUpstream();
    } catch (cause) {
      if (!this.#isCurrentRoom(generation, room)) return;
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to establish safely paused manual microphone capture',
        cause,
      );
    }
    if (!this.#isCurrentRoom(generation, room)) return;
    if (this.#localAudioPreRoll !== bridge) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Automatic pre-roll ownership changed during manual degradation',
      );
    }

    bridge.track.enabled = false;
    try {
      await bridge.destroy();
    } catch (cause) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Failed to retire automatic pre-roll during manual degradation',
        cause,
      );
    }
    if (!this.#isCurrentRoom(generation, room)) return;
    if (this.#localAudioPreRoll !== bridge) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Automatic pre-roll ownership changed while being retired',
      );
    }
    if (this.#micClone !== localMicClone || this.#rawMicTrack !== replacement) {
      throw new RealtimeVoiceError(
        'CONNECTION_FAILED',
        'Microphone ownership changed while retiring automatic pre-roll',
      );
    }
    const manualMicStream = new MediaStream([replacement]);
    this.#localAudioPreRoll = undefined;
    this.#micClone = undefined;
    this.#micStream = manualMicStream;
    localMicClone.enabled = false;
    localMicClone.stop();
  }

  async #failTransport(
    generation: number,
    room: Room,
    error: RealtimeVoiceError,
  ): Promise<void> {
    if (!this.#isCurrentRoom(generation, room)) return;
    const connecting = this.#connecting;
    await this.#teardown();
    if (connecting) {
      this.#emit({ type: 'state', state: 'error' });
      return;
    }
    await room.disconnect().catch(() => {});
    this.#emit({ type: 'error', error });
  }

  #establishManualMode(error?: unknown): void {
    this.#manualTurnControlAvailable = true;
    this.#emit(
      error === undefined
        ? { type: 'turn_mode', mode: 'manual' }
        : { type: 'turn_mode', mode: 'manual', error },
    );
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
    this.#automaticModeDegradation = undefined;
    this.#clearThinkingFallback();
    this.#bargeInInProgress = false;
    this.#playbackMutedForBargeIn = false;
    this.#warnedNonFatalKinds.clear();
    const micClone = this.#micClone;
    const rawMicTrack = this.#rawMicTrack;
    const bridge = this.#localAudioPreRoll;
    const browserVad = this.#browserVad;
    this.#manualTurnControlAvailable = false;
    this.#localAudioPreRoll = undefined;
    this.#browserVad = undefined;
    this.#micClone = undefined;
    this.#rawMicTrack = undefined;
    this.#micStream = undefined;
    if (micClone) micClone.enabled = false;
    micClone?.stop();
    if (rawMicTrack) rawMicTrack.enabled = false;
    rawMicTrack?.stop();
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
    return Promise.all([
      browserVad?.destroy().catch(() => {}),
      bridge?.destroy().catch(() => {}),
    ]).then(() => {});
  }
}

/** Identifies a misfire whose upstream publication was already safely paused. */
function isSafelyPausedMisfireCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    SAFELY_PAUSED_MISFIRE_CANCELLATION in error
  );
}

const THINKING_FALLBACK_MS = 10_000;
