import { createMaelstrom } from '@maelstrom-co/react';
import { maelstromVoice } from '@maelstrom-co/react-voice';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';

export const m = createMaelstrom({
  vessels: [calendarEntry, weatherEntry, journalEntry, tasksEntry],
}).with(maelstromVoice());
