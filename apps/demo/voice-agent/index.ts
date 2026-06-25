/**
 * Maelstrom voice agent worker.
 *
 * STT path: user mic audio → Deepgram STT → transcript → client via publishTranscription.
 * TTS path: client sends a `speak` text stream (the response's userMessage) → Cartesia TTS
 *   → published back to the room as an audio track the client attaches and plays.
 *
 * No agent LLM — the Maelstrom engine is the only orchestrator. The client receives the
 * transcript (onTranscript → processIntent) and sends the userMessage to speak (onResponse).
 *
 * Run (from this dir): node --env-file=../../../.env index.ts start
 */

import { cli, defineAgent, stt, tts, type JobContext } from '@livekit/agents';
import { STT } from '@livekit/agents-plugin-deepgram';
import { TTS } from '@livekit/agents-plugin-cartesia';
import {
  AudioSource,
  LocalAudioTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  AudioStream,
} from '@livekit/rtc-node';
import { ServerOptions } from '@livekit/agents';

/** Text-stream topic the client uses to send TTS requests. Mirrors SPEAK_TOPIC client-side. */
const SPEAK_TOPIC = 'speak';

// Silence stderr noise from optional native modules
process.on('uncaughtException', (err) => {
  // Re-throw anything that isn't a missing optional native module
  if (!String(err).includes('Cannot find module')) throw err;
});

export default defineAgent({
  entry: async (ctx: JobContext) => {
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
    const ttsTrack = LocalAudioTrack.createAudioTrack(
      'assistant-voice',
      ttsSource,
    );
    const ttsPublishOptions = new TrackPublishOptions();
    ttsPublishOptions.source = TrackSource.SOURCE_MICROPHONE;
    await room.localParticipant.publishTrack(ttsTrack, ttsPublishOptions);

    // Serialize speak requests so overlapping userMessages don't interleave frames.
    let speakChain: Promise<void> = Promise.resolve();
    async function speak(text: string) {
      const trimmed = text.trim();
      if (!trimmed) return;
      console.error('[voice-agent] TTS synthesize start:', trimmed);
      // Use the websocket streaming path (`stream()`), NOT `synthesize()`.
      // The Cartesia plugin unconditionally sets `max_buffer_delay_ms` in the
      // request body, which the HTTP `/tts/bytes` endpoint (used by
      // `synthesize()`) rejects with HTTP 400 — yielding zero audio frames and
      // no thrown error. The field is only valid on the websocket endpoint.
      const stream = cartesiaTTS.stream();
      stream.pushText(trimmed);
      stream.flush();
      stream.endInput();
      let frames = 0;
      for await (const audio of stream) {
        if (audio === tts.SynthesizeStream.END_OF_STREAM) break;
        frames++;
        await ttsSource.captureFrame(audio.frame);
      }
      stream.close();
      console.error('[voice-agent] TTS synthesize done, frames:', frames);
    }

    // Client sends the response's userMessage over the `speak` text stream.
    room.registerTextStreamHandler(SPEAK_TOPIC, (reader) => {
      void (async () => {
        const text = await reader.readAll();
        console.error('[voice-agent] speak stream received:', text);
        speakChain = speakChain
          .then(() => speak(text))
          .catch((err) => {
            console.error('[voice-agent] TTS synthesis failed', err);
          });
        await speakChain;
      })();
    });

    async function processAudioTrack(
      track: import('@livekit/rtc-node').RemoteTrack,
    ) {
      console.error('[voice-agent] processAudioTrack start', track.sid);
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
        console.error('[voice-agent] turn transcript emitted:', text);
        // publishTranscription triggers RoomEvent.TranscriptionReceived on the client
        void room.localParticipant.publishTranscription({
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

      // Listen for turn_end data packets to flush the STT buffer
      room.on(
        RoomEvent.DataReceived,
        (payload: Uint8Array, _participant, _kind, topic) => {
          if (topic !== 'turn') return;
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload)) as {
              type?: string;
            };
            if (msg.type === 'turn_end') {
              console.error('[voice-agent] turn_end received, flushing STT');
              speechStream.flush();
              // Grace window for the trailing final the flush produces, then
              // emit the whole hold as one transcript.
              if (emitTimer) clearTimeout(emitTimer);
              emitTimer = setTimeout(emitTurn, 600);
            }
          } catch {
            // ignore malformed data
          }
        },
      );

      // Buffer each final; the turn_end handler joins them into one transcript.
      for await (const event of speechStream) {
        if (event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT) continue;
        const text = event.alternatives?.[0]?.text?.trim();
        if (!text) continue;
        console.error('[voice-agent] FINAL transcript (buffered):', text);
        turnBuffer.push(text);
      }

      await pipeTask;
      speechStream.endInput();
    }

    // Handle tracks already published when agent joins
    console.error(
      '[voice-agent] user joined, existing publications:',
      userParticipant.trackPublications.size,
    );
    for (const [, publication] of userParticipant.trackPublications) {
      console.error(
        '[voice-agent] existing pub',
        publication.kind,
        'subscribed track?',
        !!publication.track,
      );
      if (publication.kind === TrackKind.KIND_AUDIO && publication.track) {
        void processAudioTrack(publication.track);
      }
    }

    // Handle tracks published after agent joins
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      console.error(
        '[voice-agent] TrackSubscribed',
        participant.identity,
        track.kind,
      );
      if (
        participant.identity !== 'user' ||
        track.kind !== TrackKind.KIND_AUDIO
      )
        return;
      void processAudioTrack(track as import('@livekit/rtc-node').RemoteTrack);
    });
  },
});

// Entry point when run directly
cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,
    wsURL: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
  }),
);
