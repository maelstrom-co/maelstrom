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

import { cli, defineAgent, stt, type JobContext } from '@livekit/agents';
import { STT } from '@livekit/agents-plugin-deepgram';
import { TTS } from '@livekit/agents-plugin-cartesia';
import {
  AudioSource,
  LocalAudioTrack,
  RoomEvent,
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
    // Wait for the user participant to join
    const userParticipant = await ctx.waitForParticipant('user');

    // Connect the agent to the room so it can publish transcriptions
    await ctx.connect();

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
      const stream = cartesiaTTS.synthesize(trimmed);
      for await (const audio of stream) {
        await ttsSource.captureFrame(audio.frame);
      }
    }

    // Client sends the response's userMessage over the `speak` text stream.
    room.registerTextStreamHandler(SPEAK_TOPIC, (reader) => {
      void (async () => {
        const text = await reader.readAll();
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
      const audioStream = new AudioStream(track);
      const speechStream = deepgramSTT.stream();
      let segmentCounter = 0;

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
              speechStream.flush();
            }
          } catch {
            // ignore malformed data
          }
        },
      );

      // Consume STT events and publish final transcripts back to the client
      for await (const event of speechStream) {
        if (event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT) continue;
        const text = event.alternatives?.[0]?.text?.trim();
        if (!text) continue;

        segmentCounter++;
        const segmentId = `seg-${segmentCounter}`;
        const now = BigInt(Date.now()) * 1_000_000n; // nanoseconds

        // publishTranscription triggers RoomEvent.TranscriptionReceived on the client
        await room.localParticipant.publishTranscription({
          participantIdentity: userParticipant.identity,
          trackSid: '',
          segments: [
            {
              id: segmentId,
              text,
              startTime: now,
              endTime: now,
              language: 'en-US',
              final: true,
            },
          ],
        });
      }

      await pipeTask;
      speechStream.endInput();
    }

    // Handle tracks already published when agent joins
    for (const [, publication] of userParticipant.trackPublications) {
      if (publication.kind === 'audio' && publication.track) {
        void processAudioTrack(publication.track);
      }
    }

    // Handle tracks published after agent joins
    room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (participant.identity !== 'user' || track.kind !== 'audio') return;
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
