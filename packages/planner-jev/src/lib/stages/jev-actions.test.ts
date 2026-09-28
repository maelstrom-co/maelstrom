import { describe, expect, test } from 'bun:test';

import {
  InstanceId,
  isOk,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import {
  type Conversation,
  conversation,
  keepAll,
} from '../__test-helpers__/actions-fixtures.js';
import {
  deferralOf,
  makeContext,
  makeRequest,
  makeResizeRequest,
  plain,
  type RequestOptions,
  spyLogger,
} from '../__test-helpers__/fixtures.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import type { SelectedInstance } from '../types.js';
import { jevActions, MAX_ACTIONS } from './jev-actions.js';

async function run(
  intent: Parameters<typeof makeRequest>[0],
  script: Conversation,
  options: RequestOptions & {
    readonly created?: readonly SelectedInstance[];
    readonly decisions?: Parameters<typeof keepAll>[2];
  } = {},
) {
  const { ask, calls } = scriptedAsk(conversation(script));
  const { logger, entries } = spyLogger();
  const selection = keepAll(
    makeRequest(intent, options),
    options.created,
    options.decisions,
  );
  const result = await jevActions(ask)(
    selection,
    makeContext(selection.input, { logger }),
  );
  return { result, calls, entries };
}

function planOf(result: Awaited<ReturnType<typeof run>>['result']) {
  if (!isOk(result))
    throw new Error(`expected a plan, got ${deferralOf(result)}`);
  return plain({
    actions: result.value.actions,
    asks: result.value.asks,
  }) as {
    actions: {
      instanceId: string;
      action: string;
      params: object;
      pending: object[];
    }[];
    asks: {
      instanceId: string;
      action: string;
      parameter: { name: string } & object;
    }[];
  };
}

describe('jevActions', () => {
  test('done on the first step gives an empty plan', async () => {
    const { result, calls } = await run('hide the tasks', {});
    expect(planOf(result)).toEqual({ actions: [], asks: [] });
    expect(calls).toHaveLength(1);
  });

  test('a resize-only turn plans no actions without asking Jev', async () => {
    const { result, calls } = await run(
      makeResizeRequest(12, 20).context.updateReasons,
      {},
    );
    expect(planOf(result)).toEqual({ actions: [], asks: [] });
    expect(calls).toHaveLength(0);
  });

  test('keeps the order of several actions and binds their parameters', async () => {
    const { result } = await run(
      'Set weather to "Tokyo", then check Buy milk',
      {
        actions: [
          {
            pick: 'weather-main/setLocation',
            params: { location: { value: 'Tokyo' } },
          },
          {
            pick: 'tasks-main/checkTask',
            params: { title: { value: 'Buy milk' } },
          },
        ],
      },
    );
    expect(planOf(result).actions).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Tokyo' },
        pending: [],
      },
      {
        instanceId: 'tasks-main',
        action: 'checkTask',
        params: { title: 'Buy milk' },
        pending: [],
      },
    ]);
  });

  test('offers transitions and then the actions of the new variant (journal openEntry)', async () => {
    const { result, calls } = await run(
      'open the entry "Monday" then go back',
      {
        select: { 'view/journal-main': 'keep' },
        actions: [
          {
            pick: 'journal-main/openEntry',
            params: { title: { value: 'Monday' } },
          },
          { pick: 'journal-main/backToList' },
        ],
      },
    );
    const first = Object.values(
      calls[0]?.questions['action/0']?.criteria ?? {},
    );
    expect(
      first.some((d) =>
        d.startsWith('journal-main, currently list: openEntry.'),
      ),
    ).toBe(true);
    expect(first.some((d) => d.includes(': backToList.'))).toBe(false);
    const actionCalls = calls.filter((call) => 'action/2' in call.questions);
    const last = Object.values(
      actionCalls[0]?.questions['action/2']?.criteria ?? {},
    );
    expect(
      last.some((d) =>
        d.startsWith('journal-main, currently list: openEntry.'),
      ),
    ).toBe(true);
    expect(planOf(result).actions.map((a) => a.action)).toEqual([
      'openEntry',
      'backToList',
    ]);
  });

  test('map showRoute moves the map to route, which offers showOverview', async () => {
    const { calls } = await run('Directions to "Central Station"', {
      actions: [
        {
          pick: 'map-main/showRoute',
          params: { destination: { value: 'Central Station' } },
        },
      ],
    });
    const second = calls.find((call) => 'action/1' in call.questions);
    const options = Object.values(
      second?.questions['action/1']?.criteria ?? {},
    );
    expect(
      options.some((d) =>
        d.startsWith('map-main, currently route: showOverview.'),
      ),
    ).toBe(true);
    const params = calls.find(
      (call) => 'param/0/destination' in call.questions,
    );
    expect(params?.questions['param/0/destination']?.criteria).toMatchObject({
      v0: '"Studio Vortex HQ"',
      v1: '"Central Station"',
    });
  });

  test('calendar addEvent moves the calendar to day, which offers showMonth', async () => {
    const { calls, result } = await run('Add "Dentist" at "15:00"', {
      actions: [
        {
          pick: 'calendar-main/addEvent',
          params: { title: { value: 'Dentist' }, time: { value: '15:00' } },
        },
      ],
    });
    const second = calls.find((call) => 'action/1' in call.questions);
    const options = Object.values(
      second?.questions['action/1']?.criteria ?? {},
    );
    expect(
      options.some((d) =>
        d.startsWith('calendar-main, currently day: showMonth.'),
      ),
    ).toBe(true);
    expect(planOf(result).actions[0]?.params).toEqual({
      title: 'Dentist',
      time: '15:00',
    });
  });

  test('deleted instances get no actions; created ones do', async () => {
    const created: SelectedInstance = {
      instanceId: InstanceId('weather-jev-1'),
      vesselId: VesselId('weather'),
      variant: VariantName('current'),
      visible: true,
      fresh: true,
      decision: 'create',
    };
    const { calls } = await run(
      'a new weather',
      {},
      { created: [created], decisions: { 'tasks-main': 'delete' } },
    );
    const options = Object.values(
      calls[0]?.questions['action/0']?.criteria ?? {},
    );
    expect(options.some((d) => d.startsWith('tasks-main'))).toBe(false);
    expect(options.some((d) => d.startsWith('weather-jev-1'))).toBe(true);
  });

  test('unsupported defers action_unsupported', async () => {
    const { result, entries } = await run('write a poem', {
      actions: [{ pick: 'unsupported' }],
    });
    expect(deferralOf(result)).toBe('jevActions/action_unsupported');
    expect(entries.find((e) => e.msg === 'jev.defer')?.data).toEqual({
      stage: 'jevActions',
      reason: 'jevActions/action_unsupported',
      question: 'action/0',
    });
  });

  test(`choosing a ${MAX_ACTIONS + 1}th action defers action_limit`, async () => {
    const { result } = await run('weekly, current, weekly, current, weekly', {
      actions: [
        { pick: 'weather-main/showWeekly' },
        { pick: 'weather-main/showCurrent' },
        { pick: 'weather-main/showWeekly' },
        { pick: 'weather-main/showCurrent' },
        { pick: 'weather-main/showWeekly' },
      ],
    });
    expect(deferralOf(result)).toBe('jevActions/action_limit');
  });

  test('stated_elsewhere keeps the action with a pending slot', async () => {
    const { result } = await run('weather for the capital of Japan', {
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: 'stated_elsewhere' },
        },
      ],
    });
    const [action] = planOf(result).actions;
    expect(action?.params).toEqual({});
    expect(action?.pending).toEqual([
      {
        name: 'location',
        type: 'string',
        description: 'City or place to request weather for',
      },
    ]);
  });

  test('not_stated drops only that action, records the ask and keeps the rest', async () => {
    const { result, calls } = await run(
      'add a task and show the weekly forecast',
      {
        actions: [
          {
            pick: 'tasks-main/addTask',
            params: { title: 'not_stated', urgent: 'omit' },
          },
          { pick: 'weather-main/showWeekly' },
        ],
      },
    );
    const plan = planOf(result);
    expect(plan.actions.map((a) => a.action)).toEqual(['showWeekly']);
    expect(plan.asks as unknown).toEqual([
      {
        instanceId: 'tasks-main',
        action: 'addTask',
        parameter: { name: 'title', type: 'string', description: 'Task title' },
      },
    ]);
    const second = calls.find((call) => 'action/1' in call.questions);
    expect(second?.state.droppedActions).toEqual([
      { instanceId: 'tasks-main', action: 'addTask' },
    ]);
  });

  test('not_stated on the only action leaves an empty plan with the ask', async () => {
    const { result } = await run('add a task', {
      actions: [
        {
          pick: 'tasks-main/addTask',
          params: { title: 'not_stated', urgent: 'omit' },
        },
      ],
    });
    const plan = planOf(result);
    expect(plan.actions).toEqual([]);
    expect(plan.asks.map((ask) => ask.parameter.name)).toEqual(['title']);
  });

  test('a dropped transition does not move the variant for later steps', async () => {
    const { calls } = await run('open an entry', {
      select: { 'view/journal-main': 'keep' },
      actions: [
        { pick: 'journal-main/openEntry', params: { title: 'not_stated' } },
      ],
    });
    const second = calls.find((call) => 'action/1' in call.questions);
    const options = Object.values(
      second?.questions['action/1']?.criteria ?? {},
    );
    expect(
      options.some((d) =>
        d.startsWith('journal-main, currently list: openEntry.'),
      ),
    ).toBe(true);
  });

  test('omit is offered only for optional parameters', async () => {
    const { calls } = await run('add "Buy bread"', {
      actions: [
        {
          pick: 'tasks-main/addTask',
          params: { title: { value: 'Buy bread' }, urgent: 'omit' },
        },
      ],
    });
    const params = calls.find((call) => 'param/0/title' in call.questions);
    expect(
      Object.keys(params?.questions['param/0/title']?.criteria ?? {}),
    ).toEqual(['v0', 'stated_elsewhere', 'not_stated']);
    expect(
      Object.keys(params?.questions['param/0/urgent']?.criteria ?? {}),
    ).toEqual(['v0', 'v1', 'stated_elsewhere', 'not_stated', 'omit']);
  });

  test('enum candidates keep only values of the declared type', async () => {
    const { calls } = await run('check it', {
      actions: [
        { pick: 'tasks-main/checkTask', params: { title: 'stated_elsewhere' } },
      ],
    });
    const params = calls.find((call) => 'param/0/title' in call.questions);
    expect(params?.questions['param/0/title']?.criteria).toEqual({
      v0: '"Buy milk"',
      v1: '"Send invoice"',
      stated_elsewhere:
        'The latest intent gives a value that no listed option clearly matches, or that several listed options could match.',
      not_stated: 'The request does not give a value.',
    });
  });

  test('the parameter question tells Jev to reject a descriptive span as a literal value', async () => {
    const { calls } = await run('weather for the capital of Japan', {
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: 'stated_elsewhere' },
        },
      ],
    });
    const params = calls.find((call) => 'param/0/location' in call.questions);
    expect(params?.questions['param/0/location']?.instructions).toContain(
      'never a phrase that describes, names indirectly or points to the value',
    );
    expect(
      params?.questions['param/0/location']?.criteria.stated_elsewhere,
    ).toContain('refers to the value indirectly');
  });
});
