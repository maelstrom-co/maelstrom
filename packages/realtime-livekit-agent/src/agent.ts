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
  TURN_TOPIC,
  TTS_TOPIC,
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
    'user',
    PARTICIPANT_JOIN_TIMEOUT_MS,
  );
  if (!userParticipant) {
    console.error(
      `[voice-agent] no 'user' participant joined within ${PARTICIPANT_JOIN_TIMEOUT_MS}ms; shutting down job`,
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
  async function speak(text: string) {
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
    // nothing, but still resolve the client's `speaking` state).
    const done: TtsDoneMessage = { type: 'tts_done' };
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
          const error: TtsErrorMessage = { type: 'tts_error' };
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

    // Push-to-talk turn buffer. Deepgram endpointing emits a FINAL transcript
    // at every natural pause, so one held utterance can yield several finals.
    // We accumulate them and publish ONE combined transcript per hold (on
    // turn_end), so the orchestrator gets a single intent per press — not a
    // chunk per pause.
    const turnBuffer: string[] = [];
    let emitTimer: ReturnType<typeof setTimeout> | null = null;
    const emitTurn = () => {
      emitTimer = null;
      const text = turnBuffer.join(' ').replace(/\s+/g, ' ').trim();
      turnBuffer.length = 0;
      if (!text) return;
      segmentCounter++;
      const now = BigInt(Date.now()) * 1_000_000n; // nanoseconds
      // publishTranscription triggers RoomEvent.TranscriptionReceived on the client.
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

    // Route turn_end packets (received by the room-scoped listener) to THIS
    // track's stream while it is the active one.
    const flushThisTurn = () => {
      speechStream.flush();
      // Grace window for the trailing final the flush produces, then emit the
      // whole hold as one transcript.
      if (emitTimer) clearTimeout(emitTimer);
      emitTimer = setTimeout(emitTurn, 600);
    };
    flushActiveTurn = flushThisTurn;

    try {
      // Buffer each final; the turn_end handler joins them into one transcript.
      await runSpeechRecognition(audioStream, speechStream, (text) => {
        turnBuffer.push(text);
      });
    } finally {
      if (flushActiveTurn === flushThisTurn) flushActiveTurn = null;
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
    if (participant.identity !== 'user' || track.kind !== TrackKind.KIND_AUDIO)
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
  speak: (text: string) => Promise<void>;
  onSpeakError: (err: unknown) => void | Promise<void>;
}): (reader: Pick<TextStreamReader, 'readAll'>) => void {
  let speakChain: Promise<void> = Promise.resolve();
  return (reader) => {
    const text = reader.readAll();
    // Reading starts immediately, but the chain may not reach `text` until
    // prior turns settle — attach a no-op handler now so a rejection in the
    // meantime is never reported as unhandled; the real handling still runs
    // below once the chain gets here.
    text.catch(() => {});
    speakChain = speakChain
      .then(() => text)
      .then((value) => deps.speak(value))
      .catch((err) => deps.onSpeakError(err));
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
