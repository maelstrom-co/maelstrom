import { createMaelstrom } from '@maelstrom-co/react';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { voiceSpike } from './voice-spike';
import { liveKitVoice } from './voice/livekit-voice';

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
] as const;

export const m = createMaelstrom({ vessels }).with(voiceSpike()).with(liveKitVoice());
