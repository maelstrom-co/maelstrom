import { createMaelstrom } from '@maelstrom-co/react';
import {
  calendarEntry,
  notesEntry,
  tasksEntry,
  weatherEntry,
} from './registrations';

export const m = createMaelstrom({
  vessels: [weatherEntry, calendarEntry, notesEntry, tasksEntry],
});
