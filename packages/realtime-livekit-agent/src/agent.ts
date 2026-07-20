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
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type RemoteTrack,
  RoomEvent,
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

// Optional native/platform bindings (LiveKit FFI prebuilds, Silero VAD) probe-
// load and throw MODULE_NOT_FOUND on unsupported platforms — that's noise, not a
// real failure. Suppress ONLY those (matched by module code + name), and re-throw
// everything else so a genuine missing dependency or startup crash stays visible
// instead of leaving the agent half-initialized with no diagnostic.
const OPTIONAL_NATIVE_MODULES = [
  '@livekit/rtc-ffi-bindings',
  '@livekit/agents-plugin-silero',
];
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  const message = err instanceof Error ? err.message : String(err);
  if (
    code === 'MODULE_NOT_FOUND' &&
    OPTIONAL_NATIVE_MODULES.some((name) => message.includes(name))
  ) {
    console.debug('[voice-agent] suppressed optional native module error:', message);
    return;
  }
  throw err;
});

const entry = async (ctx: JobContext) => {
  // Connect the agent to the room first — waitForParticipant requires a
  // connected room, and the agent must be joined to publish transcriptions.
  await ctx.connect();

  // Wait for the user participant to join
  const userParticipant = await ctx.waitForParticipant('user');

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
  room.on(
    RoomEvent.DataReceived,
    (payload: Uint8Array, _participant, _kind, topic) => {
      if (topic !== TURN_TOPIC) return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as {
          type?: string;
        };
        if (msg.type === 'turn_end') flushActiveTurn?.();
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

  // Serialize speak requests so overlapping summaries don't interleave frames.
  let speakChain: Promise<void> = Promise.resolve();
  async function speak(text: string) {
    const trimmed = text.trim();
    if (trimmed) {
      // Use the websocket streaming path (`stream()`), NOT `synthesize()`.
      // The Cartesia plugin unconditionally sets `max_buffer_delay_ms` in the
      // request body, which the HTTP `/tts/bytes` endpoint (used by
      // `synthesize()`) rejects with HTTP 400 — yielding zero audio frames and
      // no thrown error. The field is only valid on the websocket endpoint.
      const stream = cartesiaTTS.stream();
      stream.pushText(trimmed);
      stream.flush();
      stream.endInput();
      for await (const audio of stream) {
        if (audio === tts.SynthesizeStream.END_OF_STREAM) break;
        await ttsSource.captureFrame(audio.frame);
      }
      stream.close();
      // Frames are queued into the shared AudioSource but not yet heard; block
      // until the queue drains so the client collapses `speaking`→`connected`
      // on real playout end, not on synthesis end.
      await ttsSource.waitForPlayout();
    }
    // Tell the client the summary has finished playing (empty summaries play
    // nothing, but still resolve the client's `speaking` state).
    const done: TtsDoneMessage = { type: 'tts_done' };
    await localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(done)),
      { reliable: true, topic: TTS_TOPIC },
    );
  }

  // Client sends the tool-result summary over the `speak` text stream.
  room.registerTextStreamHandler(SPEAK_TOPIC, (reader) => {
    void (async () => {
      const text = await reader.readAll();
      speakChain = speakChain
        .then(() => speak(text))
        .catch(async (err) => {
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
        });
      await speakChain;
    })();
  });

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
        participantIdentity: userParticipant.identity,
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

    // Pipe audio frames into the STT stream
    const pipeTask = (async () => {
      for await (const frame of audioStream) {
        speechStream.pushFrame(frame);
      }
    })();

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

    // Buffer each final; the turn_end handler joins them into one transcript.
    for await (const event of speechStream) {
      if (event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT) continue;
      const text = event.alternatives?.[0]?.text?.trim();
      if (!text) continue;
      turnBuffer.push(text);
    }

    await pipeTask;
    speechStream.endInput();
    if (flushActiveTurn === flushThisTurn) flushActiveTurn = null;
  }

  // Handle tracks already published when agent joins
  for (const [, publication] of userParticipant.trackPublications) {
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
  cli.runApp(
    new ServerOptions({
      agent: import.meta.filename,
      wsURL: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
      apiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
      apiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
    }),
  );
}
