import { CalendarView } from '@maelstrom-co/demo-vessels/vessels/calendar.component';
import type { CalendarEventView } from '@maelstrom-co/demo-vessels/view-data';
import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';

import { recordChange, recordFailure } from '../lib/action-activity';
import { m } from '../lib/maelstrom';
import {
  calendarActions,
  getCalendarSnapshot,
  useCalendarStore,
} from './calendar.store';
import type { calendarVessel } from './calendar.vessel';
import { findByFuzzyTitle } from './find-by-fuzzy-title';

// The native demo keeps its non-today week fixtures separate from mutable records.
const EVENTS: Record<string, CalendarEventView[]> = {
  Mon: [
    {
      id: 'Mon-Team standup',
      time: '9:00',
      title: 'Team standup',
      accent: 'brand',
    },
  ],
  Wed: [
    {
      id: 'Wed-Design review',
      time: '14:00',
      title: 'Design review',
      accent: 'brand-2',
    },
    {
      id: 'Wed-Sprint planning',
      time: '16:00',
      title: 'Sprint planning',
      accent: 'brand-3',
    },
  ],
  Thu: [
    {
      id: 'Thu-1:1 with lead',
      time: '10:00',
      title: '1:1 with lead',
      accent: 'brand',
    },
  ],
  Fri: [
    { id: 'Fri-Demo day', time: '15:00', title: 'Demo day', accent: 'brand-2' },
  ],
};

function noMatchError(title: string): Error {
  const available = getCalendarSnapshot()
    .events.map((e) => `"${e.title}"`)
    .join(', ');
  return new Error(`No event matches "${title}". Available: ${available}`);
}

export default function CalendarComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof calendarVessel>) {
  const { events } = useCalendarStore();
  m.useActions('calendar', instanceId, {
    // The Chart owns view changes; these Actions have no separate data effect.
    showMonth: () => ok(undefined),
    showWeek: () => ok(undefined),
    showDay: () => ok(undefined),
    addEvent: async ({ title, time }) => {
      calendarActions.addEvent(title, time);
      const added = getCalendarSnapshot().events.at(-1);
      recordChange(
        `Added event "${added?.title ?? title}" at ${added?.time ?? time}`,
        { vesselId: 'calendar', action: 'addEvent' },
      );
      return ok(undefined);
    },
    removeEvent: async ({ title }) => {
      const match = findByFuzzyTitle(getCalendarSnapshot().events, title);
      if (!match || !calendarActions.removeEvent(title)) {
        return eventNotFound('removeEvent', title);
      }
      recordChange(`Removed event "${match.title}"`, {
        vesselId: 'calendar',
        action: 'removeEvent',
      });
      return ok(undefined);
    },
    moveEvent: async ({ title, time }) => {
      const match = findByFuzzyTitle(getCalendarSnapshot().events, title);
      if (!match || !calendarActions.moveEvent(title, time)) {
        return eventNotFound('moveEvent', title);
      }
      const moved = getCalendarSnapshot().events.find((e) => e.id === match.id);
      recordChange(`Moved "${match.title}" to ${moved?.time ?? time}`, {
        vesselId: 'calendar',
        action: 'moveEvent',
      });
      return ok(undefined);
    },
  });
  return (
    <CalendarView
      variant={variantProps.variant}
      events={events}
      weekEvents={EVENTS}
    />
  );
}

function eventNotFound(action: string, title: string) {
  recordFailure(`Couldn't find event "${title}"`, {
    vesselId: 'calendar',
    action,
  });
  return err(noMatchError(title));
}
