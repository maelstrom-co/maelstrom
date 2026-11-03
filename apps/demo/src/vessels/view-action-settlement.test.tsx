// @vitest-environment happy-dom

import type {
  EngineConnector,
  IntentResult,
  Orchestrator,
} from '@maelstrom-co/client';
import {
  ActionName,
  InstanceId,
  TilingLayoutSchema,
} from '@maelstrom-co/protocol';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  client: undefined as Orchestrator | undefined,
}));
vi.mock('../lib/maelstrom', async () => {
  const { createMaelstrom } = await import('@maelstrom-co/react');
  const { calendarEntry } = await import('./calendar.vessel');
  const { weatherEntry } = await import('./weather.vessel');
  return {
    m: createMaelstrom({ vessels: [calendarEntry, weatherEntry] }).with(
      (context) => {
        context.onOrchestrator?.((client) => {
          captured.client = client;
          return () => {
            captured.client = undefined;
          };
        });
        return {};
      },
    ),
  };
});
const { m } = await import('../lib/maelstrom');
const { default: Calendar } = await import('./calendar.component');
const { default: Weather } = await import('./weather.component');
const { getCalendarSnapshot, resetCalendarStore } = await import(
  './calendar.store'
);
const { weatherStore } = await import('./weather.store');

beforeEach(() => {
  resetCalendarStore();
  vi.spyOn(weatherStore, 'refreshDefault').mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const cases = [
  {
    vessel: 'calendar',
    from: 'month',
    to: 'week',
    action: 'showWeek',
    label: 'Week View',
  },
  {
    vessel: 'calendar',
    from: 'week',
    to: 'day',
    action: 'showDay',
    label: 'Day View',
  },
  {
    vessel: 'calendar',
    from: 'day',
    to: 'month',
    action: 'showMonth',
    label: /^\w+ \d{4}$/,
  },
  {
    vessel: 'weather',
    from: 'current',
    to: 'hourly',
    action: 'showHourly',
    label: 'Hourly Forecast',
  },
  {
    vessel: 'weather',
    from: 'hourly',
    to: 'weekly',
    action: 'showWeekly',
    label: 'Weekly Forecast',
  },
  {
    vessel: 'weather',
    from: 'weekly',
    to: 'current',
    action: 'showCurrent',
    label: 'Weather',
  },
] as const;

it.each(
  cases,
)('confirms $vessel $action after rendering without changing application data', async ({
  vessel,
  from,
  to,
  action,
  label,
}) => {
  const id = InstanceId(`view-${vessel}`);
  const layout = (variant: string) => ({
    type: 'tiling' as const,
    ...TilingLayoutSchema.parse({
      tree: [`ID:${id}`],
      instances: [{ instanceId: id, vesselId: vessel, variant }],
    }),
  });
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    process: async (request) => ({
      type: 'maelstrom_response',
      requestId: request.id,
      userMessage: 'View updated',
      rationale: '',
      layout: layout(to),
      executionPlan: [{ instanceId: id, action: ActionName(action) }],
    }),
    addAssistantMessage: async () => {},
    getHistory: async () => [],
  };
  function CalendarInstance() {
    const props = m.useVessel('calendar', id);
    return props && <Calendar {...props} />;
  }
  function WeatherInstance() {
    const props = m.useVessel('weather', id);
    return props && <Weather {...props} />;
  }
  const screen = render(
    <m.Provider
      connector={connector}
      layoutMode="tiling"
      initialLayout={layout(from)}
    >
      {vessel === 'calendar' ? <CalendarInstance /> : <WeatherInstance />}
    </m.Provider>,
  );
  await waitFor(() =>
    expect(
      captured.client?.connectionManager.store.state.connectionStatus,
    ).toBe('connected'),
  );
  const before = {
    calendar: structuredClone(getCalendarSnapshot()),
    weather: structuredClone(weatherStore.getSnapshot()),
  };
  const client = captured.client;
  if (!client) throw new Error('Client not mounted');
  let result: IntentResult | undefined;
  await act(async () => {
    result = await client.enqueueIntent('Change the view without changing data')
      .result;
  });
  expect(screen.getByText(label, { exact: true })).toBeTruthy();
  expect(result?.status).toBe('applied');
  expect(getCalendarSnapshot()).toEqual(before.calendar);
  expect(weatherStore.getSnapshot()).toEqual(before.weather);
});
