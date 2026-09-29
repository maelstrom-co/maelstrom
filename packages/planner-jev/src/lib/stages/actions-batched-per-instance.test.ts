import { describe, expect, test } from 'bun:test';

import { isOk, type Vessel, VesselSchema } from '@maelstrom-co/protocol';

import { conversation, keepAll } from '../__test-helpers__/actions-fixtures.js';
import { demoVessels } from '../__test-helpers__/demo-vessels.js';
import {
  deferralOf,
  makeContext,
  makeRequest,
  makeResizeRequest,
  plain,
  spyLogger,
  vessels,
} from '../__test-helpers__/fixtures.js';
import {
  type Payload,
  type Script,
  scriptedAsk,
  scriptedFetch,
  TEST_MODEL,
} from '../__test-helpers__/scripted-fetch.js';
import { createTypeSafeClient } from '../typesafe-client.js';
import {
  type ActionsBatchedPerInstanceOptions,
  actionsBatchedPerInstance,
} from './actions-batched-per-instance.js';
import { MAX_CONCURRENT_CALLS } from './fan-out.js';
import type { GateAnswer, Selection2 } from './stage-types.js';

const CALENDAR_ONLY = {
  'weather-main': 'delete',
  'tasks-main': 'delete',
  'map-main': 'delete',
  'journal-main': 'delete',
} as const;

function selectionOf(
  intent: string,
  decisions: Parameters<typeof keepAll>[2] = {},
): Selection2 {
  return keepAll(makeRequest(intent), [], decisions);
}

async function run(
  selection: Selection2,
  script: Script,
  options: ActionsBatchedPerInstanceOptions = {},
) {
  const { ask, calls } = scriptedAsk(script);
  const { logger, entries } = spyLogger();
  const result = await actionsBatchedPerInstance(ask, options)(
    selection,
    makeContext(selection.input, { logger }),
  );
  return { result, calls, logs: entries };
}

function logged(
  logs: Awaited<ReturnType<typeof run>>['logs'],
  msg: string,
): unknown[] {
  return logs.filter((entry) => entry.msg === msg).map((entry) => entry.data);
}

const MAP_ONLY = {
  ...CALENDAR_ONLY,
  'calendar-main': 'delete',
  'map-main': 'keep',
} as const;

const TASKS_ONLY = {
  ...CALENDAR_ONLY,
  'calendar-main': 'delete',
  'tasks-main': 'keep',
} as const;

function mapSelection(intent: string, variant: string): Selection2 {
  return keepAll(
    makeRequest(intent, { variants: { map: variant } }),
    [],
    MAP_ONLY,
  );
}

/** The map fixture in its overview view, its route view's showRoute overridden. */
function divergentShowRouteSelection(
  intent: string,
  showRoute: Record<string, unknown>,
): Selection2 {
  const catalog: Vessel[] = vessels.map((vessel) =>
    vessel.id === 'map'
      ? VesselSchema.parse({
          ...vessel,
          variants: Object.fromEntries(
            Object.entries(vessel.variants).map(([name, variant]) => [
              name,
              name === 'route'
                ? {
                    ...variant,
                    actions: variant.actions.map((action) =>
                      action.name === 'showRoute'
                        ? { ...action, ...showRoute }
                        : action,
                    ),
                  }
                : variant,
            ]),
          ),
        })
      : vessel,
  );
  return keepAll(
    makeRequest(intent, { variants: { map: 'overview' }, vessels: catalog }),
    [],
    MAP_ONLY,
  );
}

function demoCalendarSelection(intent: string): Selection2 {
  return keepAll(
    makeRequest(intent, { vessels: demoVessels }),
    [],
    CALENDAR_ONLY,
  );
}

/** A budget small enough to split these fixtures over several calls. */
const SPLIT_BYTES = 2200;

function requestBytes(payload: Payload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

function planned(result: Awaited<ReturnType<typeof run>>['result']) {
  if (!isOk(result))
    throw new Error(`expected a plan, got ${deferralOf(result)}`);
  return plain({ actions: result.value.actions, asks: result.value.asks }) as {
    actions: {
      instanceId: string;
      action: string;
      params: Record<string, unknown>;
    }[];
    asks: unknown[];
  };
}

/** Answers every question from `choices`, `none`/`not_stated`/`done`-like defaults elsewhere. */
function answering(choices: Record<string, string>): Script {
  return (payload: Payload) => ({
    choices: Object.fromEntries(
      Object.keys(payload.questions).map((id) => [
        id,
        choices[id] ?? (id.startsWith('param/') ? 'not_stated' : 'none'),
      ]),
    ),
  });
}

describe('actionsBatchedPerInstance', () => {
  test('asks three slots per instance and every reachable parameter in one call', async () => {
    const { calls } = await run(
      selectionOf('week view, then add standup', CALENDAR_ONLY),
      answering({}),
    );
    expect(calls).toHaveLength(1);
    const questions = calls[0]?.questions ?? {};
    expect(Object.keys(questions['calendar-main/1']?.criteria ?? {})).toEqual([
      'showWeek',
      'addEvent',
      'none',
      'unsupported',
    ]);
    expect(Object.keys(questions['calendar-main/2']?.criteria ?? {})).toEqual([
      'week:showMonth',
      'week:addEvent',
      'day:showMonth',
      'day:addEvent',
      'none',
      'unsupported',
    ]);
    expect(questions['calendar-main/2']?.criteria['week:addEvent']).toBe(
      "If its first action leaves it in its week view: addEvent. Add an event to today's schedule",
    );
    expect(questions['calendar-main/3']).toBeDefined();
    expect(
      Object.keys(questions).filter((id) => id.startsWith('param/')),
    ).toEqual([
      'param/calendar-main/1/addEvent/title',
      'param/calendar-main/1/addEvent/time',
      'param/calendar-main/2/week:addEvent/title',
      'param/calendar-main/2/week:addEvent/time',
      'param/calendar-main/2/day:addEvent/title',
      'param/calendar-main/2/day:addEvent/time',
    ]);
  });

  test('tells slot 2 that showing the instance is no action and one request counts once', async () => {
    const { calls } = await run(
      selectionOf('show me the calendar and add standup', CALENDAR_ONLY),
      answering({}),
    );
    const second = calls[0]?.questions['calendar-main/2'];
    expect(second?.instructions).toContain(
      'asking to show, open or bring up calendar-main is not one, and one request is never counted twice',
    );
    expect(second?.instructions).toContain(
      'Choose an option only when the intent requests two of them on calendar-main, or asks for the same one twice; otherwise choose none.',
    );
    expect(second?.criteria.none).toBe(
      'The latest intent requests at most one view change or content edit on calendar-main, besides perhaps showing it.',
    );
  });

  test('offers one slot-2 option per premise view, shared by first actions that end there', async () => {
    const { calls } = await run(
      selectionOf('journal', {
        ...CALENDAR_ONLY,
        'calendar-main': 'delete',
        'weather-main': 'keep',
      }),
      answering({}),
    );
    const second = Object.keys(
      calls[0]?.questions['weather-main/2']?.criteria ?? {},
    );
    expect(second).toEqual([
      'current:setLocation',
      'current:showWeekly',
      'weekly:setLocation',
      'weekly:showCurrent',
      'none',
      'unsupported',
    ]);
  });

  test('walks the slot-2 answer whose premise matches slot 1 and binds only walked parameters', async () => {
    const { result } = await run(
      selectionOf('week view, then add standup', CALENDAR_ONLY),
      answering({
        'calendar-main/1': 'showWeek',
        'calendar-main/2': 'week:addEvent',
        'param/calendar-main/1/addEvent/title': 'v0',
        'param/calendar-main/2/week:addEvent/title': 'v4',
        'param/calendar-main/2/week:addEvent/time': 'stated_elsewhere',
        'param/calendar-main/2/day:addEvent/title': 'v1',
      }),
    );
    expect(planned(result).actions).toEqual([
      {
        instanceId: 'calendar-main',
        action: 'showWeek',
        params: {},
        pending: [],
      } as never,
      {
        instanceId: 'calendar-main',
        action: 'addEvent',
        params: { title: 'standup' },
        pending: [expect.objectContaining({ name: 'time' })],
      } as never,
    ]);
  });

  test('drops a second moveEvent whose bound parameters repeat the first', async () => {
    const { result, logs } = await run(
      demoCalendarSelection('move "Gym" to "8:00" twice'),
      answering({
        'calendar-main/1': 'moveEvent',
        'calendar-main/2': 'day:moveEvent',
        'param/calendar-main/1/moveEvent/title': 'v0',
        'param/calendar-main/1/moveEvent/time': 'v1',
        'param/calendar-main/2/day:moveEvent/title': 'v0',
        'param/calendar-main/2/day:moveEvent/time': 'v1',
      }),
    );
    expect(planned(result).actions).toEqual([
      expect.objectContaining({
        action: 'moveEvent',
        params: { title: 'Gym', time: '8:00' },
      }),
    ]);
    expect(logged(logs, 'jev.duplicate_action_dropped')).toHaveLength(1);
  });

  test('keeps two moveEvent calls for two different events', async () => {
    const { result } = await run(
      demoCalendarSelection(
        'move "Gym" to "8:00" and "Design review" to "11:00"',
      ),
      answering({
        'calendar-main/1': 'moveEvent',
        'calendar-main/2': 'day:moveEvent',
        'param/calendar-main/1/moveEvent/title': 'v0',
        'param/calendar-main/1/moveEvent/time': 'v1',
        'param/calendar-main/2/day:moveEvent/title': 'v2',
        'param/calendar-main/2/day:moveEvent/time': 'v3',
      }),
    );
    expect(planned(result).actions).toEqual([
      expect.objectContaining({
        action: 'moveEvent',
        params: { title: 'Gym', time: '8:00' },
      }),
      expect.objectContaining({
        action: 'moveEvent',
        params: { title: 'Design review', time: '11:00' },
      }),
    ]);
  });

  test('drops a second action whose name and bound parameters repeat an earlier one, regardless of the idempotent flag', async () => {
    const { result, logs } = await run(
      selectionOf('add "Buy milk" twice', TASKS_ONLY),
      answering({
        'tasks-main/1': 'addTask',
        'tasks-main/2': 'list:addTask',
        'param/tasks-main/1/addTask/title': 'v0',
        'param/tasks-main/2/list:addTask/title': 'v0',
        'param/tasks-main/1/addTask/urgent': 'omit',
        'param/tasks-main/2/list:addTask/urgent': 'omit',
      }),
    );
    expect(planned(result).actions).toEqual([
      expect.objectContaining({
        action: 'addTask',
        params: { title: 'Buy milk' },
      }),
    ]);
    expect(logged(logs, 'jev.duplicate_action_dropped')).toEqual([
      expect.objectContaining({
        instanceId: 'tasks-main',
        action: 'addTask',
        params: { title: 'Buy milk' },
      }),
    ]);
  });

  test('keeps two actions with the same name and different bound parameters', async () => {
    const { result } = await run(
      selectionOf('add "Buy milk" and "Send invoice"', TASKS_ONLY),
      answering({
        'tasks-main/1': 'addTask',
        'tasks-main/2': 'list:addTask',
        'param/tasks-main/1/addTask/title': 'v0',
        'param/tasks-main/2/list:addTask/title': 'v1',
        'param/tasks-main/1/addTask/urgent': 'omit',
        'param/tasks-main/2/list:addTask/urgent': 'omit',
      }),
    );
    expect(planned(result).actions.map((action) => action.params)).toEqual([
      { title: 'Buy milk' },
      { title: 'Send invoice' },
    ]);
  });

  test('drops a repeated parameterless action', async () => {
    const parameterlessRoute = vessels.map((vessel) =>
      vessel.id !== 'map'
        ? vessel
        : {
            ...vessel,
            variants: Object.fromEntries(
              Object.entries(vessel.variants).map(([name, variant]) => [
                name,
                {
                  ...variant,
                  actions: variant.actions.map((action) =>
                    action.name === 'showRoute'
                      ? { ...action, parameters: [] }
                      : action,
                  ),
                },
              ]),
            ),
          },
    );
    const { result } = await run(
      keepAll(
        makeRequest('show the route, and show it again', {
          vessels: parameterlessRoute,
          variants: { map: 'route' },
        }),
        [],
        MAP_ONLY,
      ),
      answering({
        'map-main/1': 'showRoute',
        'map-main/2': 'route:showRoute',
      }),
    );
    expect(planned(result).actions).toEqual([
      {
        instanceId: 'map-main',
        action: 'showRoute',
        params: {},
        pending: [],
      } as never,
    ]);
  });

  test.each([
    ['the second', 'v0', 'stated_elsewhere'],
    ['the first', 'stated_elsewhere', 'v0'],
    ['both', 'stated_elsewhere', 'stated_elsewhere'],
  ])('keeps a repeated action when a parameter is still pending on %s slot', async (_name, first, second) => {
    const { result, logs } = await run(
      selectionOf('add "Buy milk" twice', TASKS_ONLY),
      answering({
        'tasks-main/1': 'addTask',
        'tasks-main/2': 'list:addTask',
        'param/tasks-main/1/addTask/title': first,
        'param/tasks-main/2/list:addTask/title': second,
        'param/tasks-main/1/addTask/urgent': 'omit',
        'param/tasks-main/2/list:addTask/urgent': 'omit',
      }),
    );
    expect(planned(result).actions.map((action) => action.action)).toEqual([
      'addTask',
      'addTask',
    ]);
    expect(logged(logs, 'jev.duplicate_action_dropped')).toEqual([]);
  });

  test('asks once for a parameter two slots of the same action both leave unanswered', async () => {
    const { result } = await run(
      selectionOf('add a task, and another', TASKS_ONLY),
      answering({
        'tasks-main/1': 'addTask',
        'tasks-main/2': 'list:addTask',
        'param/tasks-main/1/addTask/urgent': 'omit',
        'param/tasks-main/2/list:addTask/urgent': 'omit',
      }),
    );
    expect(planned(result)).toMatchObject({
      actions: [],
      asks: [
        {
          instanceId: 'tasks-main',
          action: 'addTask',
          parameter: { name: 'title' },
        },
      ],
    });
    expect(planned(result).asks).toHaveLength(1);
  });

  test('asks separately for a parameter two different moveEvent calls leave unanswered', async () => {
    const { result } = await run(
      demoCalendarSelection('move "Gym" and "Design review"'),
      answering({
        'calendar-main/1': 'moveEvent',
        'calendar-main/2': 'day:moveEvent',
        'param/calendar-main/1/moveEvent/title': 'v0',
        'param/calendar-main/2/day:moveEvent/title': 'v1',
      }),
    );
    expect(planned(result).asks).toEqual([
      expect.objectContaining({
        action: 'moveEvent',
        parameter: expect.objectContaining({ name: 'time' }),
      }),
      expect.objectContaining({
        action: 'moveEvent',
        parameter: expect.objectContaining({ name: 'time' }),
      }),
    ]);
  });

  test('asks once for a parameter a repeated moveEvent call leaves unanswered', async () => {
    const { result } = await run(
      demoCalendarSelection('move "Gym", move "Gym"'),
      answering({
        'calendar-main/1': 'moveEvent',
        'calendar-main/2': 'day:moveEvent',
        'param/calendar-main/1/moveEvent/title': 'v0',
        'param/calendar-main/2/day:moveEvent/title': 'v0',
      }),
    );
    expect(planned(result).asks).toEqual([
      expect.objectContaining({
        action: 'moveEvent',
        parameter: expect.objectContaining({ name: 'time' }),
      }),
    ]);
  });

  test('asks separately for a parameter name two actions or two instances share', async () => {
    const actions = await run(
      demoCalendarSelection('add "Gym" and move "Gym"'),
      answering({
        'calendar-main/1': 'addEvent',
        'calendar-main/2': 'day:moveEvent',
        'param/calendar-main/1/addEvent/title': 'v0',
        'param/calendar-main/2/day:moveEvent/title': 'v0',
      }),
    );
    expect(
      planned(actions.result).asks.map(
        (ask) => (ask as { action: string }).action,
      ),
    ).toEqual(['addEvent', 'moveEvent']);
    const instances = await run(
      selectionOf('add an event and a task', {
        ...CALENDAR_ONLY,
        'tasks-main': 'keep',
      }),
      answering({
        'calendar-main/1': 'addEvent',
        'tasks-main/1': 'addTask',
        'param/tasks-main/1/addTask/urgent': 'omit',
      }),
    );
    expect(
      planned(instances.result)
        .asks.filter(
          (ask) =>
            (ask as { parameter: { name: string } }).parameter.name === 'title',
        )
        .map((ask) => (ask as { instanceId: string }).instanceId),
    ).toEqual(['calendar-main', 'tasks-main']);
  });

  test('promotes a second slot whose premise is the current view when the first slot answers none', async () => {
    const { result, logs } = await run(
      mapSelection('route there again', 'route'),
      answering({
        'map-main/1': 'none',
        'map-main/2': 'route:showRoute',
        'param/map-main/2/route:showRoute/destination': 'v0',
      }),
    );
    expect(planned(result).actions).toEqual([
      {
        instanceId: 'map-main',
        action: 'showRoute',
        params: { destination: 'Studio Vortex HQ' },
        pending: [],
      } as never,
    ]);
    expect(logged(logs, 'jev.slot_promoted')).toEqual([
      expect.objectContaining({
        instanceId: 'map-main',
        action: 'showRoute',
        premise: 'route',
        current: 'route',
        via: 'premise',
      }),
    ]);
  });

  test("promotes the current view's action of the same name when the premise view differs", async () => {
    const { result, logs } = await run(
      mapSelection('take me there again', 'overview'),
      answering({
        'map-main/1': 'none',
        'map-main/2': 'route:showRoute',
        'param/map-main/1/showRoute/destination': 'v0',
        'param/map-main/2/route:showRoute/destination': 'v1',
      }),
    );
    expect(planned(result).actions).toEqual([
      {
        instanceId: 'map-main',
        action: 'showRoute',
        params: { destination: 'Studio Vortex HQ' },
        pending: [],
      } as never,
    ]);
    expect(logged(logs, 'jev.slot_promoted')).toEqual([
      expect.objectContaining({
        instanceId: 'map-main',
        action: 'showRoute',
        premise: 'route',
        current: 'overview',
        via: 'same_name',
      }),
    ]);
  });

  test("defers as a premise mismatch when the current view's same-named action takes other parameters", async () => {
    const { result, logs } = await run(
      divergentShowRouteSelection('take me there again', {
        parameters: [
          {
            name: 'origin',
            type: 'string',
            description: 'Where the route starts',
            required: true,
          },
        ],
      }),
      answering({
        'map-main/1': 'none',
        'map-main/2': 'route:showRoute',
        'param/map-main/1/showRoute/destination': 'v0',
      }),
    );
    expect(deferralOf(result)).toBe('jevActions/premise_mismatch');
    expect(logged(logs, 'jev.slot_promoted')).toEqual([]);
  });

  test("defers as a premise mismatch when the current view's same-named action leaves it in another view", async () => {
    const { result, logs } = await run(
      divergentShowRouteSelection('take me there again', {
        transitionsTo: 'overview',
      }),
      answering({
        'map-main/1': 'none',
        'map-main/2': 'route:showRoute',
        'param/map-main/1/showRoute/destination': 'v0',
        'param/map-main/2/route:showRoute/destination': 'v0',
      }),
    );
    expect(deferralOf(result)).toBe('jevActions/premise_mismatch');
    expect(logged(logs, 'jev.slot_promoted')).toEqual([]);
  });

  test('defers as a premise mismatch when the promoted action is not legal in the current view', async () => {
    const { result, logs } = await run(
      mapSelection('back to the overview', 'overview'),
      answering({
        'map-main/1': 'none',
        'map-main/2': 'route:showOverview',
      }),
    );
    expect(deferralOf(result)).toBe('jevActions/premise_mismatch');
    expect(logged(logs, 'jev.slot_discarded')).toEqual([
      expect.objectContaining({
        instanceId: 'map-main',
        action: 'showOverview',
        premise: 'route',
        current: 'overview',
      }),
    ]);
  });

  test('plans nothing when both the first and second slots answer none', async () => {
    const { result, logs } = await run(
      mapSelection('nothing to do', 'route'),
      answering({ 'map-main/1': 'none', 'map-main/2': 'none' }),
    );
    expect(planned(result)).toEqual({ actions: [], asks: [] });
    expect(logged(logs, 'jev.slot_promoted')).toEqual([]);
    expect(
      isOk(result) && result.value.answers.map((answer) => answer.question),
    ).toEqual(['map-main/1', 'map-main/2']);
  });

  test('defers the action limit when a third slot names an action after a promotion', async () => {
    const { result } = await run(
      mapSelection('route there again, then the overview', 'route'),
      answering({
        'map-main/1': 'none',
        'map-main/2': 'route:showRoute',
        'map-main/3': 'route:showOverview',
        'param/map-main/2/route:showRoute/destination': 'v0',
      }),
    );
    expect(deferralOf(result)).toBe('jevActions/action_limit');
  });

  test('defers a slot-2 answer whose premise does not match slot 1', async () => {
    const { result } = await run(
      selectionOf('week view, then add standup', CALENDAR_ONLY),
      answering({
        'calendar-main/1': 'showWeek',
        'calendar-main/2': 'day:addEvent',
      }),
    );
    expect(deferralOf(result)).toBe('jevActions/premise_mismatch');
  });

  test('plans two actions and never consumes a third slot answering none', async () => {
    const { result } = await run(
      selectionOf('week, then month', CALENDAR_ONLY),
      answering({
        'calendar-main/1': 'showWeek',
        'calendar-main/2': 'week:showMonth',
      }),
    );
    expect(planned(result).actions.map((a) => a.action)).toEqual([
      'showWeek',
      'showMonth',
    ]);
    expect(
      isOk(result) && result.value.answers.map((answer) => answer.question),
    ).toEqual(['calendar-main/1', 'calendar-main/2']);
  });

  test('defers the action limit when a third slot names an action', async () => {
    const { result } = await run(
      selectionOf('week, month, week', CALENDAR_ONLY),
      answering({
        'calendar-main/1': 'showWeek',
        'calendar-main/2': 'week:showMonth',
        'calendar-main/3': 'month:showWeek',
      }),
    );
    expect(deferralOf(result)).toBe('jevActions/action_limit');
  });

  test('defers an unsupported slot 2 behind a none slot 1, and an unsupported slot 1', async () => {
    const second = await run(
      selectionOf('nothing', CALENDAR_ONLY),
      answering({ 'calendar-main/2': 'unsupported' }),
    );
    expect(deferralOf(second.result)).toBe('jevActions/action_unsupported');
    const unsupported = await run(
      selectionOf('fly', CALENDAR_ONLY),
      answering({ 'calendar-main/1': 'unsupported' }),
    );
    expect(deferralOf(unsupported.result)).toBe(
      'jevActions/action_unsupported',
    );
  });

  test('asks for a parameter the request does not state and drops its action', async () => {
    const { result } = await run(
      selectionOf('set the weather', {
        ...CALENDAR_ONLY,
        'weather-main': 'keep',
      }),
      answering({ 'weather-main/1': 'setLocation' }),
    );
    expect(planned(result)).toMatchObject({
      actions: [],
      asks: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          parameter: { name: 'location' },
        },
      ],
    });
  });

  test('defers more actions than the limit across instances', async () => {
    const { result } = await run(
      selectionOf('lots'),
      answering({
        'calendar-main/1': 'showWeek',
        'calendar-main/2': 'week:showMonth',
        'weather-main/1': 'showWeekly',
        'weather-main/2': 'weekly:showCurrent',
        'map-main/1': 'showRoute',
        'param/map-main/1/showRoute/destination': 'v0',
      }),
    );
    expect(deferralOf(result)).toBe('jevActions/action_limit');
  });

  test('counts the action limit after repeated actions are dropped', async () => {
    const { result, logs } = await run(
      selectionOf('week then month, add "Buy milk" twice, route there twice'),
      answering({
        'calendar-main/1': 'showWeek',
        'calendar-main/2': 'week:showMonth',
        'tasks-main/1': 'addTask',
        'tasks-main/2': 'list:addTask',
        'param/tasks-main/1/addTask/title': 'v0',
        'param/tasks-main/2/list:addTask/title': 'v0',
        'param/tasks-main/1/addTask/urgent': 'omit',
        'param/tasks-main/2/list:addTask/urgent': 'omit',
        'map-main/1': 'showRoute',
        'map-main/2': 'route:showRoute',
        'param/map-main/1/showRoute/destination': 'v0',
        'param/map-main/2/route:showRoute/destination': 'v0',
      }),
    );
    expect(planned(result).actions.map((action) => action.action)).toEqual([
      'showWeek',
      'showMonth',
      'addTask',
      'showRoute',
    ]);
    expect(logged(logs, 'jev.duplicate_action_dropped')).toHaveLength(2);
  });

  test('keeps each instance in order, instances in selection order', async () => {
    const { result, calls } = await run(
      selectionOf('Set weather to "Tokyo", then week view'),
      conversation({
        actions: [
          {
            pick: 'weather-main/setLocation',
            params: { location: { value: 'Tokyo' } },
          },
          { pick: 'calendar-main/showWeek' },
        ],
      }),
    );
    expect(calls).toHaveLength(1);
    expect(planned(result).actions.map((a) => a.action)).toEqual([
      'showWeek',
      'setLocation',
    ]);
  });

  test('splits the questions across calls at the byte budget and merges the answers', async () => {
    const selection = selectionOf('week view, then add standup', CALENDAR_ONLY);
    const choices = {
      'calendar-main/1': 'showWeek',
      'calendar-main/2': 'week:addEvent',
      'param/calendar-main/1/addEvent/title': 'v0',
      'param/calendar-main/2/week:addEvent/title': 'v4',
      'param/calendar-main/2/week:addEvent/time': 'stated_elsewhere',
      'param/calendar-main/2/day:addEvent/title': 'v1',
    };
    const whole = await run(selection, answering(choices));
    const split = await run(selection, answering(choices), {
      maxRequestBytes: SPLIT_BYTES,
    });
    expect(whole.calls).toHaveLength(1);
    expect(split.calls.length).toBeGreaterThan(1);
    for (const call of split.calls) {
      expect(requestBytes(call)).toBeLessThanOrEqual(SPLIT_BYTES);
      expect(call.state).toEqual(whole.calls[0]?.state as never);
    }
    expect(
      split.calls.flatMap((call) => Object.keys(call.questions)).sort(),
    ).toEqual(Object.keys(whole.calls[0]?.questions ?? {}).sort());
    expect(planned(split.result)).toEqual(planned(whole.result));
  });

  test('defers batch_cap when the state and one question alone are over the budget', async () => {
    const { result, calls } = await run(
      selectionOf('week view, then add standup', CALENDAR_ONLY),
      answering({}),
      { maxRequestBytes: 300 },
    );
    expect(calls).toEqual([]);
    expect(deferralOf(result)).toBe('jevActions/batch_cap');
  });

  test('defers when one chunk fails', async () => {
    const { result } = await run(
      selectionOf('week view, then add standup', CALENDAR_ONLY),
      (payload, call) =>
        Object.hasOwn(payload.questions, 'calendar-main/3')
          ? { status: 500 }
          : answering({})(payload, call),
      { maxRequestBytes: SPLIT_BYTES },
    );
    expect(deferralOf(result)).toBe('jevActions/provider_http');
  });

  test('keeps at most the concurrency cap of calls in flight', async () => {
    const selection = selectionOf('week view, then add standup');
    const { fetch, calls } = scriptedFetch(answering({}));
    let active = 0;
    let peak = 0;
    const traced = (async (url: string, init: RequestInit) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return await fetch(url, init);
      } finally {
        active -= 1;
      }
    }) as unknown as typeof fetch;
    const ask = createTypeSafeClient({
      apiKey: 'typesafe-test-key',
      model: TEST_MODEL,
      fetch: traced,
      timeoutMs: 5000,
    });
    const result = await actionsBatchedPerInstance(ask, {
      maxRequestBytes: SPLIT_BYTES,
    })(selection, makeContext(selection.input));
    expect(calls.length).toBeGreaterThan(MAX_CONCURRENT_CALLS);
    expect(peak).toBe(MAX_CONCURRENT_CALLS);
    expect(planned(result)).toEqual({ actions: [], asks: [] });
  });

  test('makes no call on a resize-only turn or when the gate says no actions are needed', async () => {
    const needsActions: GateAnswer = {
      answer: 'no',
      probability: 0.3,
      confidence: 0.4,
    };
    for (const selection of [
      { ...selectionOf('put the map left'), gates: { needsActions } },
      keepAll(makeResizeRequest(12, 20)),
    ]) {
      const { result, calls } = await run(selection, answering({}));
      expect(calls).toEqual([]);
      expect(planned(result)).toEqual({ actions: [], asks: [] });
    }
  });
});
