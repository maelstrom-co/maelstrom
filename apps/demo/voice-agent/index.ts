/**
 * Maelstrom voice agent worker — Phase 1 (STT-only).
 *
 * Pipeline: user mic audio → Deepgram STT → transcript → client via publishTranscription.
 * No LLM or TTS in Phase 1. The Maelstrom client receives the transcript and calls
 * orchestrator.processIntent() via the onTranscript seam.
 *
 * Run: node --env-file=../../.env index.ts start
 */

import { cli, defineAgent, stt, type JobContext } from '@livekit/agents';
import { STT } from '@livekit/agents-plugin-deepgram';
import { AudioStream, RoomEvent } from '@livekit/rtc-node';
import { ServerOptions } from '@livekit/agents';

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

    async function processAudioTrack(track: import('@livekit/rtc-node').RemoteTrack) {
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
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant, _kind, topic) => {
        if (topic !== 'turn') return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as { type?: string };
          if (msg.type === 'turn_end') {
            speechStream.flush();
          }
        } catch {
          // ignore malformed data
        }
      });

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
