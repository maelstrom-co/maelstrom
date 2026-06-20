import { createMaelstrom, type MaelstromInstance } from '@maelstrom-co/react';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
] as const;

export const m: MaelstromInstance<typeof vessels> = createMaelstrom({
  vessels,
});
