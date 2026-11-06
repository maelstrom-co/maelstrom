import { VesselCard } from '@maelstrom-co/demo-vessels/components/vessel-card';
import { CalendarView } from '@maelstrom-co/demo-vessels/vessels/calendar.component';
import { JournalView } from '@maelstrom-co/demo-vessels/vessels/journal.component';
import { LabsView } from '@maelstrom-co/demo-vessels/vessels/labs.component';
import { LAB_MARKER_SLUGS } from '@maelstrom-co/demo-vessels/vessels/labs.vessel.def';
import { TasksView } from '@maelstrom-co/demo-vessels/vessels/tasks.component';
import { WeatherView } from '@maelstrom-co/demo-vessels/vessels/weather.component';
import type { CalendarEventView } from '@maelstrom-co/demo-vessels/view-data';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { useEffect } from 'react';
import { z } from 'zod';

import { m } from '../browser/maelstrom';
import { localDate, useWorkspace } from '../browser/workspace-state';
import type {
  calendarVessel,
  journalVessel,
  labsVessel,
  tasksVessel,
  weatherVessel,
} from './definitions';

export function Journal({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof journalVessel>) {
  const { store, state } = useWorkspace();
  m.useActions('journal', instanceId, {
    createEntry: () => store.action(instanceId, 'createEntry'),
    writeContent: () => store.action(instanceId, 'writeContent'),
    openEntry: (params) =>
      store.action(instanceId, 'openEntry', () => store.selectEntry(params)),
    backToList: () =>
      store.action(instanceId, 'backToList', () =>
        store.update({ entryId: null }),
      ),
  });
  return (
    <JournalView
      variant={variantProps.variant}
      entries={state.records.journal}
      activeEntryId={state.entryId}
    />
  );
}

export function Tasks({ instanceId }: TypedVesselProps<typeof tasksVessel>) {
  const { store, state } = useWorkspace();
  m.useActions('tasks', instanceId, {
    addTask: () => store.action(instanceId, 'addTask'),
    removeTask: () => store.action(instanceId, 'removeTask'),
    checkTask: () => store.action(instanceId, 'checkTask'),
    uncheckTask: () => store.action(instanceId, 'uncheckTask'),
    addSubtask: () => store.action(instanceId, 'addSubtask'),
  });
  return <TasksView tasks={state.records.tasks} />;
}

export function Calendar({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof calendarVessel>) {
  const { store, state } = useWorkspace();
  m.useActions('calendar', instanceId, {
    addEvent: () => store.action(instanceId, 'addEvent'),
    removeEvent: () => store.action(instanceId, 'removeEvent'),
    moveEvent: () => store.action(instanceId, 'moveEvent'),
    showDay: () => store.action(instanceId, 'showDay', () => {}),
    showWeek: () => store.action(instanceId, 'showWeek', () => {}),
    showMonth: () => store.action(instanceId, 'showMonth', () => {}),
  });
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
  instanceId,
  variantProps,
}: TypedVesselProps<typeof weatherVessel>) {
  const { store, state } = useWorkspace();
  useEffect(() => {
    void store.loadWeather();
  }, [store]);
  m.useActions('weather', instanceId, {
    showCurrent: () => store.action(instanceId, 'showCurrent', () => {}),
    showHourly: () => store.action(instanceId, 'showHourly', () => {}),
    showWeekly: () => store.action(instanceId, 'showWeekly', () => {}),
    setLocation: ({ location }) =>
      store.action(instanceId, 'setLocation', () =>
        store.setLocation(location),
      ),
  });
  return state.weather ? (
    <WeatherView variant={variantProps.variant} state={state.weather} />
  ) : (
    <VesselCard label="Weather" accent="brand-2" meta="Live data">
      <p role="status">{state.weatherError ?? 'Loading live weather…'}</p>
    </VesselCard>
  );
}

export function Labs({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof labsVessel>) {
  const { store, state } = useWorkspace();
  m.useActions('labs', instanceId, {
    showList: () => store.action(instanceId, 'showList', () => {}),
    showTrends: () => store.action(instanceId, 'showTrends', () => {}),
    selectMarker: ({ markerSlug }) =>
      store.action(instanceId, 'selectMarker', () =>
        store.update({ marker: z.enum(LAB_MARKER_SLUGS).parse(markerSlug) }),
      ),
  });
  return <LabsView variant={variantProps.variant} marker={state.marker} />;
}
