import { createMaelstrom } from '@maelstrom-co/react';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';

export const m = createMaelstrom({
  vessels: [calendarEntry, weatherEntry, journalEntry, tasksEntry],
});
