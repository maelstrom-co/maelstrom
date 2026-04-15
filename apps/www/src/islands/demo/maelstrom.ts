import { createMaelstrom } from '@maelstrom-co/react';
import { calendarEntry } from './registrations';
import { notesEntry } from './registrations';
import { tasksEntry } from './registrations';
import { weatherEntry } from './registrations';

export const m = createMaelstrom({
  vessels: [weatherEntry, calendarEntry, notesEntry, tasksEntry],
});
