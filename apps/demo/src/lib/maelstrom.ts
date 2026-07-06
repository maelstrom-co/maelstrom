import { createMaelstrom } from '@maelstrom-co/react';
import { liveKitVoice } from '@maelstrom-co/livekit-voice';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { voiceSpike } from './voice-spike';
import { getLivekitToken } from './voice/get-livekit-token';

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
] as const;

export const m = createMaelstrom({ vessels })
  .with(voiceSpike())
  .with(
    // Adapt the TanStack Start server fn (called with `{ data }`) to the plain
    // `(roomName) => { token, url }` transport the extension expects.
    liveKitVoice({
      getToken: (roomName) => getLivekitToken({ data: { roomName } }),
    }),
  );
