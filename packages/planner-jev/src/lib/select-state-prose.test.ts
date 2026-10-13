import { describe, expect, test } from 'bun:test';

import { demoVessels } from './__test-helpers__/demo-vessels.js';
import { renderSelectStateAsProse } from './select-state-prose.js';

const selectState = {
  intent: [
    {
      type: 'user_intent',
      intent: 'Show the map next to the current widgets.',
    },
  ],
  history: [],
  chartDimensions: { columns: 12, rows: 8 },
  currentLayout: [
    'V:1,1,1',
    'ID:calendar-main',
    'ID:weather-main',
    'ID:tasks-main',
  ],
  instances: [
    {
      instanceId: 'calendar-main',
      vesselId: 'calendar',
      variant: 'month',
      visible: true,
    },
    {
      instanceId: 'weather-main',
      vesselId: 'weather',
      variant: 'current',
      visible: true,
    },
    {
      instanceId: 'tasks-main',
      vesselId: 'tasks',
      variant: 'list',
      visible: true,
    },
    {
      instanceId: 'map-main',
      vesselId: 'map',
      variant: 'overview',
      visible: false,
    },
  ],
  vessels: demoVessels,
};

describe('renderSelectStateAsProse', () => {
  test('quotes the request and lists the visible and hidden instances by name and id', () => {
    const prose = renderSelectStateAsProse(selectState);
    expect(prose).toContain(
      'The user\'s latest request: "Show the map next to the current widgets."',
    );
    expect(prose).toContain(
      'On screen now: Calendar (calendar-main, month view), Weather (weather-main, current view), Tasks (tasks-main, list view).',
    );
    expect(prose).toContain('Hidden: Map (map-main, overview view).');
  });

  test('describes the layout and the chart size', () => {
    const prose = renderSelectStateAsProse(selectState);
    expect(prose).toContain(
      'Layout: calendar-main on the left; weather-main in the middle; tasks-main on the right.',
    );
    expect(prose).toContain('Chart size: 12 columns by 8 rows.');
  });

  test('gives one line per widget type with its views and action names, no parameter schemas', () => {
    const prose = renderSelectStateAsProse(selectState);
    const calendar = prose
      .split('\n')
      .find((line) => line.startsWith('- Calendar (calendar):'));
    expect(calendar).toContain('Calendar widget for viewing dates');
    expect(calendar).toContain('Views: month (default), week, day.');
    expect(calendar).toContain('Actions: showWeek, showDay, addEvent');
    expect(prose).not.toContain('Time like 9:00 or 14:30');
    expect(prose).not.toContain('"parameters"');
    expect(prose.length).toBeLessThan(JSON.stringify(selectState).length / 3);
  });

  test('says when nothing is hidden or on screen', () => {
    const prose = renderSelectStateAsProse({
      ...selectState,
      currentLayout: [],
      instances: [],
    });
    expect(prose).toContain('On screen now: nothing.');
    expect(prose).toContain('Hidden: nothing.');
    expect(prose).toContain('Layout: the chart is empty.');
  });

  test('renders every request, a resize, a widget change and the recent conversation', () => {
    const prose = renderSelectStateAsProse({
      ...selectState,
      intent: [
        { type: 'user_intent', intent: 'Add the map.' },
        {
          type: 'chart_resize',
          previous: { columns: 12, rows: 8 },
          current: { columns: 8, rows: 8 },
        },
        {
          type: 'vessel_mutation',
          instanceId: 'tasks-main',
          changes: 'checked "Buy milk"',
        },
        { type: 'user_intent', intent: 'Then hide the weather.' },
      ],
      history: [
        { role: 'user', content: 'Show my tasks.' },
        { role: 'assistant', content: 'Your tasks are on screen.' },
      ],
    });
    expect(prose).toStartWith(
      'What happened since the last turn, in order:\n- The user asked: "Add the map."\n- The chart was resized from 12 columns by 8 rows to 8 columns by 8 rows.\n- tasks-main changed: checked "Buy milk".\n- The user asked: "Then hide the weather."\n\n',
    );
    expect(prose).not.toContain('keep showing what is shown now');
    expect(prose).toContain(
      'Earlier in the conversation:\nUser: Show my tasks.\nAssistant: Your tasks are on screen.',
    );
  });

  test('says a resize with no request asks for no change to what is shown', () => {
    const prose = renderSelectStateAsProse({
      ...selectState,
      intent: [
        {
          type: 'chart_resize',
          previous: { columns: 30, rows: 18 },
          current: { columns: 12, rows: 20 },
        },
      ],
    });
    expect(prose).toStartWith(
      'There is no new request from the user.\nThe chart was resized from 30 columns by 18 rows to 12 columns by 20 rows. Only the size changed: keep showing what is shown now.',
    );
  });

  test('renders the reasons in the order they arrived', () => {
    const prose = renderSelectStateAsProse({
      ...selectState,
      intent: [
        {
          type: 'chart_resize',
          previous: { columns: 12, rows: 8 },
          current: { columns: 8, rows: 8 },
        },
        { type: 'user_intent', intent: 'Add the map.' },
        {
          type: 'vessel_mutation',
          instanceId: 'tasks-main',
          changes: 'checked "Buy milk"',
        },
      ],
    });
    const resize = prose.indexOf('The chart was resized');
    const request = prose.indexOf('"Add the map."');
    const mutation = prose.indexOf('tasks-main changed');
    expect(resize).toBeGreaterThanOrEqual(0);
    expect(request).toBeGreaterThan(resize);
    expect(mutation).toBeGreaterThan(request);
  });

  test('says only the size changed only when every reason is a resize', () => {
    const resize = {
      type: 'chart_resize',
      previous: { columns: 12, rows: 8 },
      current: { columns: 8, rows: 8 },
    };
    const mutation = {
      type: 'vessel_mutation',
      instanceId: 'tasks-main',
      changes: 'checked "Buy milk"',
    };
    const render = (intent: readonly object[]) =>
      renderSelectStateAsProse({ ...selectState, intent });
    expect(render([mutation])).not.toContain('Only the size changed');
    expect(render([resize, mutation])).not.toContain('Only the size changed');
    expect(render([resize, resize])).toContain(
      'Only the size changed: keep showing what is shown now.',
    );
  });

  test('falls back to JSON when an entry of the state is malformed', () => {
    const malformed = [
      { ...selectState, intent: [null] },
      { ...selectState, intent: [{ type: 'user_intent' }] },
      { ...selectState, intent: [{ type: 'chart_resize', previous: {} }] },
      { ...selectState, intent: [{ type: 'vessel_mutation', changes: 1 }] },
      { ...selectState, instances: [{ instanceId: 'map-main' }] },
      { ...selectState, vessels: [{ id: 'map' }] },
      { ...selectState, history: [null] },
      { ...selectState, chartDimensions: { columns: 'wide' } },
    ];
    for (const state of malformed)
      expect(renderSelectStateAsProse(state)).toBe(JSON.stringify(state));
  });

  test('names an instance of an unknown widget type by its type id', () => {
    const prose = renderSelectStateAsProse({
      ...selectState,
      instances: [
        {
          instanceId: 'clock-main',
          vesselId: 'clock',
          variant: 'analog',
          visible: true,
        },
      ],
    });
    expect(prose).toContain('On screen now: clock (clock-main, analog view).');
  });

  test('passes any other value through JSON.stringify unchanged', () => {
    const layoutState = {
      intent: [{ type: 'user_intent', intent: 'Swap them.' }],
      instances: [],
    };
    expect(renderSelectStateAsProse(layoutState)).toBe(
      JSON.stringify(layoutState),
    );
    expect(renderSelectStateAsProse({ question: 'x' })).toBe(
      '{"question":"x"}',
    );
    expect(renderSelectStateAsProse([1, 2])).toBe('[1,2]');
  });
});
