/**
 * Maelstrom voice agent worker.
 *
 * STT path: user mic audio → Deepgram STT → transcript → client via publishTranscription.
 * TTS path: client sends a `speak` text stream (the response's summary) → Cartesia TTS
 *   → published back to the room as an audio track the client attaches and plays.
 *
 * No agent LLM — the Maelstrom engine is the only orchestrator. The client receives the
 * transcript (synthesized into an update_ui tool call) and sends the tool-result summary
 * back to speak.
 */

import {
  cli,
  defineAgent,
  ServerOptions,
  stt,
  tts,
  type JobContext,
} from '@livekit/agents';
import { STT } from '@livekit/agents-plugin-deepgram';
import { TTS } from '@livekit/agents-plugin-cartesia';
import {
  type AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type RemoteTrack,
  RoomEvent,
  type TextStreamReader,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import {
  SPEAK_TOPIC,
  SPEAK_UTTERANCE_ID_ATTR,
  TURN_TOPIC,
  TTS_TOPIC,
  USER_PARTICIPANT_IDENTITY,
  type TtsDoneMessage,
  type TtsErrorMessage,
} from '@maelstrom-co/realtime-livekit/protocol';

// Cap how long the agent holds a job waiting for the user to connect before it
// releases the worker slot — LiveKit's waitForParticipant has no timeout of its
// own and would otherwise block the job forever.
const PARTICIPANT_JOIN_TIMEOUT_MS = 60_000;

const entry = async (ctx: JobContext) => {
  // Connect the agent to the room first — waitForParticipant requires a
  // connected room, and the agent must be joined to publish transcriptions.
  await ctx.connect();

  // Wait for the user participant to join, but never hang forever: if nobody
  // connects before the deadline, release the job instead of holding the slot.
  const userParticipant = await waitForParticipantOrTimeout(
    ctx,
    USER_PARTICIPANT_IDENTITY,
    PARTICIPANT_JOIN_TIMEOUT_MS,
  );
  if (!userParticipant) {
    console.error(
      `[voice-agent] no '${USER_PARTICIPANT_IDENTITY}' participant joined within ${PARTICIPANT_JOIN_TIMEOUT_MS}ms; shutting down job`,
    );
    ctx.shutdown('user participant did not join');
    return;
  }
  // Bind the now-narrowed participant to a const so the hoisted closures below
  // (which lose flow narrowing across the function boundary) use it without an
  // assertion — same pattern as localParticipant.
  const user = userParticipant;

  const deepgramSTT = new STT({
    apiKey: process.env.DEEPGRAM_API_KEY,
    model: 'nova-2',
    language: 'en-US',
  });
  // Fallback ceiling for emitting a push-to-talk turn whose flush-final never
  // arrives; resolved (and validated) here so a bad value fails a starting job.
  const flushTimeoutMs = resolveFlushTimeoutMs();

  // Find the user's audio track (may already be published or arrive shortly)
  const room = ctx.room;
  // After ctx.connect() the agent is joined, so its local participant exists.
  // Guard the optional field first, THEN bind — so the const is inferred as
  // non-optional and the hoisted speak()/emitTurn() closures below (which lose
  // flow narrowing across the function boundary) use it without an assertion.
  if (!room.localParticipant) {
    throw new Error('agent room has no local participant after connect');
  }
  const localParticipant = room.localParticipant;

  // Single room-scoped turn_end listener, registered ONCE (not per track).
  // Each processAudioTrack sets `flushActiveTurn` to flush ITS speechStream,
  // so a turn_end packet always routes to the currently-active track. The old
  // per-track registration leaked a listener per invocation and flushed stale
  // streams once more than one track existed.
  let flushActiveTurn: (() => void) | null = null;
  // Assigned once the TTS source exists (below); a barge-in `tts_cancel` routes
  // here to abort the in-flight synthesis.
  let cancelActiveTts: (() => void) | null = null;
  room.on(
    RoomEvent.DataReceived,
    (payload: Uint8Array, _participant, _kind, topic) => {
      if (topic !== TURN_TOPIC) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
        };
        if (msg.type === 'turn_end') flushActiveTurn?.();
        else if (msg.type === 'tts_cancel') cancelActiveTts?.();
      } catch (err) {
        console.warn('[voice-agent] ignoring malformed turn packet', err);
      }
    },
  );

  // --- TTS return path (Cartesia) ---
  // Publish a single audio track up front; each speak request captures frames
  // into its shared AudioSource. Cartesia reads CARTESIA_API_KEY from env and
  // defaults to the sonic-3 model + default voice.
  const cartesiaTTS = new TTS();
  cartesiaTTS.on('error', (e) => {
    console.error('[voice-agent] Cartesia TTS error event:', e);
  });
  const ttsSource = new AudioSource(
    cartesiaTTS.sampleRate,
    cartesiaTTS.numChannels,
  );
  const ttsTrack = LocalAudioTrack.createAudioTrack('assistant-voice', ttsSource);
  const ttsPublishOptions = new TrackPublishOptions();
  ttsPublishOptions.source = TrackSource.SOURCE_MICROPHONE;
  await localParticipant.publishTrack(ttsTrack, ttsPublishOptions);

  // The synthesis stream currently draining into `ttsSource`, so a barge-in can
  // abort it mid-flight. Null while no speak() is in progress.
  let activeTtsStream: tts.SynthesizeStream | null = null;
  // The utterance id currently being synthesized, echoed back on this
  // utterance's `tts_done`/`tts_error` so the client can correlate late status.
  let activeUtteranceId: number | undefined;
  async function speak(text: string, utteranceId: number | undefined) {
    activeUtteranceId = utteranceId;
    const trimmed = text.trim();
    if (trimmed) {
      // Use the websocket streaming path (`stream()`), NOT `synthesize()`.
      // The Cartesia plugin unconditionally sets `max_buffer_delay_ms` in the
      // request body, which the HTTP `/tts/bytes` endpoint (used by
      // `synthesize()`) rejects with HTTP 400 — yielding zero audio frames and
      // no thrown error. The field is only valid on the websocket endpoint.
      const stream = cartesiaTTS.stream();
      activeTtsStream = stream;
      try {
        stream.pushText(trimmed);
        stream.flush();
        stream.endInput();
        await pumpTtsStream(stream, (frame) => ttsSource.captureFrame(frame));
        // Frames are queued into the shared AudioSource but not yet heard; block
        // until the queue drains so the client collapses `speaking`→`connected`
        // on real playout end, not on synthesis end. A barge-in `clearQueue()`
        // resolves this early through the same path.
        await ttsSource.waitForPlayout();
      } finally {
        if (activeTtsStream === stream) activeTtsStream = null;
      }
    }
    // Tell the client the summary has finished playing (empty summaries play
    // nothing, but still resolve the client's `speaking` state). The utterance id
    // lets the client drop this if it already barged past this utterance.
    const done: TtsDoneMessage = { type: 'tts_done', utteranceId };
    await localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(done)),
      { reliable: true, topic: TTS_TOPIC },
    );
  }

  cancelActiveTts = () => cancelInFlightTts(activeTtsStream, ttsSource);

  // Client sends the tool-result summary over the `speak` text stream.
  room.registerTextStreamHandler(
    SPEAK_TOPIC,
    createSpeakHandler({
      speak,
      onSpeakError: async (err) => {
        console.error('[voice-agent] TTS synthesis failed', err);
        // Signal the client so its UI can indicate speak-back failed rather
        // than waiting indefinitely for audio that will never arrive.
        try {
          const error: TtsErrorMessage = {
            type: 'tts_error',
            utteranceId: activeUtteranceId,
          };
          await localParticipant.publishData(
            new TextEncoder().encode(JSON.stringify(error)),
            { reliable: true, topic: TTS_TOPIC },
          );
        } catch (signalErr) {
          console.error(
            '[voice-agent] failed to signal TTS error to client',
            signalErr,
          );
        }
      },
    }),
  );

  async function processAudioTrack(track: RemoteTrack) {
    const audioStream = new AudioStream(track);
    const speechStream = deepgramSTT.stream();
    let segmentCounter = 0;

    // publishTranscription triggers RoomEvent.TranscriptionReceived on the client.
    const publishTranscript = (text: string) => {
      segmentCounter++;
      const now = BigInt(Date.now()) * 1_000_000n; // nanoseconds
      void localParticipant.publishTranscription({
        participantIdentity: user.identity,
        trackSid: '',
        segments: [
          {
            id: `seg-${segmentCounter}`,
            text,
            startTime: now,
            endTime: now,
            language: 'en-US',
            final: true,
          },
        ],
      });
    };

    // One combined intent per push-to-talk hold (not a chunk per Deepgram pause),
    // emitted on the flush-final with a fallback for empty taps.
    const aggregator = createTurnAggregator({ flushTimeoutMs, emit: publishTranscript });

    // Route turn_end packets (received by the room-scoped listener) to THIS
    // track's stream while it is the active one.
    const flushThisTurn = () => {
      speechStream.flush();
      aggregator.endTurn();
    };
    flushActiveTurn = flushThisTurn;

    try {
      // Feed each final to the aggregator; it tags, buffers, and emits per turn.
      await runSpeechRecognition(audioStream, speechStream, (text) => {
        aggregator.pushFinal(text);
      });
    } finally {
      if (flushActiveTurn === flushThisTurn) flushActiveTurn = null;
      aggregator.dispose();
    }
  }

  // Handle tracks already published when agent joins
  for (const [, publication] of user.trackPublications) {
    if (publication.kind === TrackKind.KIND_AUDIO && publication.track) {
      void processAudioTrack(publication.track);
    }
  }

  // Handle tracks published after agent joins
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (
      participant.identity !== USER_PARTICIPANT_IDENTITY ||
      track.kind !== TrackKind.KIND_AUDIO
    )
      return;
    void processAudioTrack(track as RemoteTrack);
  });
};

/**
 * Builds the Maelstrom voice agent definition (the LiveKit `defineAgent` job).
 * Kept as a factory so provider options (STT/TTS) can be threaded through later
 * without changing the module's default export.
 */
export function defineMaelstromVoiceAgent() {
  return defineAgent({ entry });
}

/**
 * Default export is the agent definition itself: LiveKit's worker re-imports the
 * file named in `ServerOptions.agent` and reads its default export, so this must
 * be the agent — `runVoiceAgent` points `agent` at this same compiled module.
 */
export default defineMaelstromVoiceAgent();

/**
 * Boots the agent as a standalone worker process (separate from the app). Reads
 * LiveKit connection config from the environment; run it from a thin entry that
 * loads `.env` first.
 */
export function runVoiceAgent() {
  const { wsURL, apiKey, apiSecret } = resolveLiveKitCredentials();
  // Validate early so a bad MAELSTROM_STT_FLUSH_TIMEOUT_MS fails worker startup,
  // not a mid-turn job — same fail-closed posture as credential resolution.
  resolveFlushTimeoutMs();
  cli.runApp(
    new ServerOptions({
      agent: import.meta.filename,
      wsURL,
      apiKey,
      apiSecret,
    }),
  );
}

/**
 * Resolves LiveKit connection config from the environment, failing closed: any
 * missing credential throws (listing all that are absent) rather than silently
 * substituting insecure local-dev defaults that would point the worker at the
 * wrong server.
 */
export function resolveLiveKitCredentials(env: NodeJS.ProcessEnv = process.env): {
  wsURL: string;
  apiKey: string;
  apiSecret: string;
} {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = env;
  const missing: string[] = [];
  if (!LIVEKIT_URL) missing.push('LIVEKIT_URL');
  if (!LIVEKIT_API_KEY) missing.push('LIVEKIT_API_KEY');
  if (!LIVEKIT_API_SECRET) missing.push('LIVEKIT_API_SECRET');
  if (missing.length > 0) {
    throw new Error(
      `Missing required LiveKit environment variable(s): ${missing.join(', ')}`,
    );
  }
  return {
    wsURL: LIVEKIT_URL as string,
    apiKey: LIVEKIT_API_KEY as string,
    apiSecret: LIVEKIT_API_SECRET as string,
  };
}

/**
 * Resolves the STT turn-flush fallback timeout (ms) from
 * `MAELSTROM_STT_FLUSH_TIMEOUT_MS`, defaulting to 2000. This is only a fallback:
 * a turn normally emits the instant the flush-produced final arrives, and the
 * timer fires solely when that final never comes (an empty push-to-talk tap).
 * Fails closed like credential resolution — a non-numeric or non-positive value
 * throws at startup rather than silently degrading turn emission.
 */
export function resolveFlushTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MAELSTROM_STT_FLUSH_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_FLUSH_TIMEOUT_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(
      `Invalid MAELSTROM_STT_FLUSH_TIMEOUT_MS: expected a positive number of milliseconds, got ${JSON.stringify(raw)}`,
    );
  }
  return ms;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 2000;

/**
 * Races {@link JobContext.waitForParticipant} against a deadline so a job never
 * blocks forever on a participant that never connects. Resolves the participant
 * on join, or `null` on timeout — the SDK method has no timeout of its own and
 * only settles on ParticipantConnected / room Disconnected.
 */
export async function waitForParticipantOrTimeout(
  ctx: JobContext,
  identity: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<JobContext['waitForParticipant']>> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([ctx.waitForParticipant(identity), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Drains a TTS synthesis stream into `captureFrame`, always closing the stream
 * — even on error — so a mid-synthesis failure can't leak the Cartesia
 * websocket connection.
 */
export async function pumpTtsStream(
  stream: tts.SynthesizeStream,
  captureFrame: (frame: AudioFrame) => Promise<void>,
): Promise<void> {
  try {
    for await (const audio of stream) {
      if (audio === tts.SynthesizeStream.END_OF_STREAM) break;
      await captureFrame(audio.frame);
    }
  } finally {
    stream.close();
  }
}

/**
 * Aborts an in-flight barge-in TTS: closes the synthesis stream (terminating the
 * pump's for-await via the stream's close sentinel) and clears the audio queue.
 * `clearQueue()` also resolves any pending `waitForPlayout()`, so the blocked
 * `speak()` unblocks and publishes `tts_done` through its normal path — the
 * client needs no extra signal. Both operations are idempotent and safe when the
 * stream is null (no speak in progress) or already ended.
 */
export function cancelInFlightTts(
  stream: tts.SynthesizeStream | null,
  source: Pick<AudioSource, 'clearQueue'>,
): void {
  stream?.close();
  source.clearQueue();
}

/**
 * Builds the `speak` text-stream handler LiveKit invokes fire-and-forget (it
 * never awaits or catches the callback's return), so every awaited step inside
 * must stay catch-covered or a rejection kills the worker process.
 *
 * Serializes turns through a chain private to this handler instance, so
 * overlapping summaries can't interleave frames; a failed turn's `onSpeakError`
 * still resolves the chain, so a bad turn never poisons the ones after it.
 * `speakChain` is reassigned synchronously (no `await` before it), so turn
 * order tracks call order even when one turn's `readAll()` resolves before
 * another's — awaiting first would let a fast later call jump the queue.
 */
export function createSpeakHandler(deps: {
  speak: (text: string, utteranceId: number | undefined) => Promise<void>;
  onSpeakError: (err: unknown) => void | Promise<void>;
}): (
  reader: Pick<TextStreamReader, 'readAll'> & {
    info?: { attributes?: Record<string, string> };
  },
) => void {
  let speakChain: Promise<void> = Promise.resolve();
  return (reader) => {
    const text = reader.readAll();
    // Correlate this utterance with its later TTS status: the client stamps an id
    // on the stream attributes, and the worker echoes it on `tts_done`/`tts_error`
    // so the client can drop status for an utterance it already barged past.
    const utteranceId = parseUtteranceId(reader.info?.attributes?.[SPEAK_UTTERANCE_ID_ATTR]);
    // Reading starts immediately, but the chain may not reach `text` until
    // prior turns settle — attach a no-op handler now so a rejection in the
    // meantime is never reported as unhandled; the real handling still runs
    // below once the chain gets here.
    text.catch(() => {});
    speakChain = speakChain
      .then(() => text)
      .then((value) => deps.speak(value, utteranceId))
      .catch((err) => deps.onSpeakError(err));
  };
}

// Attributes are strings on the wire; a missing or non-numeric id yields
// undefined, so the worker echoes no id and the client falls back to type-only
// handling of the status packet.
function parseUtteranceId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const id = Number(raw);
  return Number.isFinite(id) ? id : undefined;
}

/**
 * Aggregates Deepgram finals into one transcript per push-to-talk hold.
 *
 * Deepgram emits a final at every natural pause, so one hold yields several
 * finals; `flush()` (called on the client's `turn_end`) forces a trailing final
 * for any audio after the last pause. This buffers a hold's finals and publishes
 * them as a single intent, closing two races the naive "flush then emit after a
 * fixed delay" had:
 *
 * - **Truncation**: a turn emits the instant its flush-final arrives (ack-driven)
 *   rather than after a fixed grace, so a slow flush can't clip the trailing
 *   words. The timer is a pure fallback for a hold that produced no flush-final
 *   at all (an empty tap).
 * - **Cross-turn leakage**: every final is tagged with the turn active when it
 *   arrives and a turn's emit consumes only its own finals, so a flush-final that
 *   lands after the fallback already emitted its turn is dropped, never prepended
 *   to the next turn's intent.
 *
 * The caller pairs {@link endTurn} with `speechStream.flush()`; this owns only
 * the buffering, emit timing, and turn tagging.
 */
export function createTurnAggregator(opts: {
  flushTimeoutMs: number;
  emit: (text: string) => void;
}): { pushFinal: (text: string) => void; endTurn: () => void; dispose: () => void } {
  const { flushTimeoutMs, emit } = opts;
  const buffer: Array<{ turnId: number; text: string }> = [];
  // The turn live speech currently accumulates into.
  let currentTurnId = 0;
  // The turn whose flush-final is still expected, or null. The first final after
  // a turn_end is that turn's trailing final; keeping this set past the fallback
  // firing (for a turn that had content) is what lets a late flush-final be
  // recognized and dropped instead of leaking forward.
  let awaitingFlushForTurn: number | null = null;
  let lastEmittedTurnId = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function drain(turnId: number): string {
    const parts: string[] = [];
    for (let i = 0; i < buffer.length; ) {
      if (buffer[i].turnId === turnId) {
        parts.push(buffer[i].text);
        buffer.splice(i, 1);
      } else {
        i++;
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function emitTurn(turnId: number, viaTimer: boolean): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const text = drain(turnId);
    // Already emitted (the fallback fired, and this is the late flush-final's ack):
    // its finals were just drained out of the buffer above and are discarded here,
    // so a straggler is dropped rather than republished or leaked.
    if (turnId <= lastEmittedTurnId) return;
    lastEmittedTurnId = turnId;
    if (currentTurnId <= turnId) currentTurnId = turnId + 1;
    if (viaTimer && text === '') {
      // Empty tap: no flush-final will ever come, so stop waiting or the next
      // turn's first final would be mistaken for this turn's trailing final.
      awaitingFlushForTurn = null;
    }
    if (text === '') return;
    emit(text);
  }

  return {
    pushFinal(text: string): void {
      if (awaitingFlushForTurn !== null) {
        // The trailing final flush() produced — belongs to the just-ended turn.
        const flushed = awaitingFlushForTurn;
        awaitingFlushForTurn = null;
        buffer.push({ turnId: flushed, text });
        emitTurn(flushed, false);
      } else {
        buffer.push({ turnId: currentTurnId, text });
      }
    },
    endTurn(): void {
      awaitingFlushForTurn = currentTurnId;
      const flushedTurn = currentTurnId;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => emitTurn(flushedTurn, true), flushTimeoutMs);
    },
    dispose(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Runs one STT session for a track: pumps audio frames into `speechStream` and
 * consumes its transcript events, invoking `onFinalTranscript` per final. Input
 * is ended as soon as the audio drains — the consume loop only terminates after
 * endInput(), so ending it after the loop would deadlock — and the stream is
 * always closed, including on error.
 */
export async function runSpeechRecognition(
  audioStream: AsyncIterable<AudioFrame>,
  speechStream: stt.SpeechStream,
  onFinalTranscript: (text: string) => void,
): Promise<void> {
  const pipeTask = (async () => {
    try {
      for await (const frame of audioStream) {
        speechStream.pushFrame(frame);
      }
    } finally {
      speechStream.endInput();
    }
  })();
  // A failing consume loop skips the success-path `await pipeTask` and closes the
  // stream in the finally below; observe the pipe here so its next push/endInput
  // against the now-closed stream can't surface as an unhandled rejection.
  pipeTask.catch((err) => {
    console.warn('[voice-agent] pipe task failed during teardown', err);
  });
  try {
    for await (const event of speechStream) {
      if (event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT) continue;
      const text = event.alternatives?.[0]?.text?.trim();
      if (!text) continue;
      onFinalTranscript(text);
    }
    await pipeTask;
  } finally {
    speechStream.close();
  }
}
