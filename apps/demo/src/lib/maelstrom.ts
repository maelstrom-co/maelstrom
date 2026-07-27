import { createMaelstrom } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import { OpenAIAdapter } from '@maelstrom-co/realtime/openai';
import { LiveKitAdapter } from '@maelstrom-co/realtime-livekit';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { mapEntry } from '../vessels/map.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { isDebugRequested } from './debug-mode';
import { mintOpenAIToken } from './mint-token';
import { orchestrationLegibility } from './orchestration-legibility';
import { getLivekitToken } from './voice/get-livekit-token';

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
  mapEntry,
] as const;

export const m = createMaelstrom({
  vessels,
})
  .with(maelstromRealtime({ createAdapter, debug: isDebugRequested() }))
  .with(orchestrationLegibility);

// Provider is chosen at build time by VITE_VOICE_PROVIDER: `livekit` selects the
// cascaded LiveKit transport (push-to-talk), anything else the speech-native
// OpenAI transport. Runs once per session, so per-session server resources (the
// token mint, the room name) are scoped by sessionId here.
function createAdapter({
  sessionId,
}: CreateAdapterContext): RealtimeProviderAdapter {
  if (import.meta.env.VITE_VOICE_PROVIDER === 'livekit') {
    return new LiveKitAdapter({
      mintToken: (roomName) => getLivekitToken({ data: { roomName } }),
      roomName: `maelstrom-${sessionId}`,
      debug: isDebugRequested(),
    });
  }
  return new OpenAIAdapter({
    mintToken: () => mintOpenAIToken(sessionId),
    debug: isDebugRequested(),
  });
}
