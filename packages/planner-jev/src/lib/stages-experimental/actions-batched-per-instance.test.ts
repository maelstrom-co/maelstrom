import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import { conversation, keepAll } from '../__test-helpers__/actions-fixtures.js';
import {
  deferralOf,
  makeContext,
  makeRequest,
  makeResizeRequest,
  plain,
} from '../__test-helpers__/fixtures.js';
import {
  type Payload,
  type Script,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import { perInstanceBatchedActions } from './actions-batched-per-instance.js';
import type { GateAnswer, Selection2 } from './types.js';

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

async function run(selection: Selection2, script: Script) {
  const { ask, calls } = scriptedAsk(script);
  const result = await perInstanceBatchedActions(ask)(
    selection,
    makeContext(selection.input),
  );
  return { result, calls };
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

describe('perInstanceBatchedActions', () => {
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

  test('ignores slot 2 when slot 1 is none and defers unsupported', async () => {
    const quiet = await run(
      selectionOf('nothing', CALENDAR_ONLY),
      answering({ 'calendar-main/2': 'week:addEvent' }),
    );
    expect(planned(quiet.result)).toEqual({ actions: [], asks: [] });
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
