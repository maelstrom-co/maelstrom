import { VesselCard } from '@maelstrom-co/demo-vessels/components/vessel-card';
import { CalendarView } from '@maelstrom-co/demo-vessels/vessels/calendar.component';
import { JournalView } from '@maelstrom-co/demo-vessels/vessels/journal.component';
import { LabsView } from '@maelstrom-co/demo-vessels/vessels/labs.component';
import { TasksView } from '@maelstrom-co/demo-vessels/vessels/tasks.component';
import { WeatherView } from '@maelstrom-co/demo-vessels/vessels/weather.component';
import type { CalendarEventView } from '@maelstrom-co/demo-vessels/view-data';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useEffect } from 'react';

import { localDate, useWorkspace } from '../browser/workspace-state';
import type {
  calendarVessel,
  journalVessel,
  labsVessel,
  weatherVessel,
} from './definitions';

export function Journal({
  variantProps,
}: TypedVesselProps<typeof journalVessel>) {
  const { state } = useWorkspace();
  return (
    <JournalView
      variant={variantProps.variant}
      entries={state.records.journal}
      activeEntryId={state.entryId}
    />
  );
}

export function Tasks() {
  const { state } = useWorkspace();
  return <TasksView tasks={state.records.tasks} />;
}

export function Calendar({
  variantProps,
}: TypedVesselProps<typeof calendarVessel>) {
  const { store, state } = useWorkspace();
  const date = new Date(`${state.calendarDate}T12:00:00`);
  const weekEvents: Record<string, CalendarEventView[]> = {};
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const display = (event: (typeof state.records.calendar)[number]) => ({
    ...event,
    title: `${event.title} · ${event.timeZone}`,
  });
  for (let index = 0; index < 7; index++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    weekEvents[days[index]] = state.records.calendar
      .filter((event) => event.date === localDate(day))
      .map(display);
  }
  return (
    <div className="calendar-host">
      <label className="calendar-date">
        Date{' '}
        <input
          aria-label="Calendar date"
          type="date"
          value={state.calendarDate}
          onChange={(event) => {
            if (event.target.value)
              store.update({ calendarDate: event.target.value });
          }}
        />
      </label>
      <CalendarView
        variant={variantProps.variant}
        today={date}
        dayLabel={state.calendarDate}
        weekLabel={`Week of ${localDate(monday)}`}
        events={state.records.calendar
          .filter((event) => event.date === state.calendarDate)
          .map(display)}
        weekEvents={weekEvents}
      />
    </div>
  );
}

export function Weather({
  variantProps,
}: TypedVesselProps<typeof weatherVessel>) {
  const { store, state } = useWorkspace();
  useEffect(() => {
    void store.loadWeather();
  }, [store]);
  return state.weather ? (
    <WeatherView variant={variantProps.variant} state={state.weather} />
  ) : (
    <VesselCard label="Weather" accent="brand-2" meta="Live data">
      <p role="status">{state.weatherError ?? 'Loading live weather…'}</p>
    </VesselCard>
  );
}

export function Labs({ variantProps }: TypedVesselProps<typeof labsVessel>) {
  const { state } = useWorkspace();
  return <LabsView variant={variantProps.variant} marker={state.marker} />;
}
