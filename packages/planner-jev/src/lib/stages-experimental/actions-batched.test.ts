import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

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
} from '../__test-helpers__/fixtures.js';
import {
  type Script,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import { MAX_ACTIONS } from '../stages/jev-actions.js';
import type { Ask } from '../typesafe-client.js';
import { batchedActions, MAX_BATCH_QUESTIONS } from './actions-batched.js';
import { stepwiseActions } from './actions-stepwise.js';
import type { ActionsStage, GateAnswer, Selection2 } from './types.js';

const CALENDAR_AND_WEATHER = {
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
  stage: (ask: Ask) => ActionsStage,
  selection: Selection2,
  script: Script,
) {
  const { ask, calls } = scriptedAsk(script);
  const result = await stage(ask)(selection, makeContext(selection.input));
  return { result, calls };
}

function planned(result: Awaited<ReturnType<typeof run>>['result']) {
  if (!isOk(result))
    throw new Error(`expected a plan, got ${deferralOf(result)}`);
  return plain({ actions: result.value.actions, asks: result.value.asks }) as {
    actions: { instanceId: string; action: string }[];
    asks: unknown[];
  };
}

const TWO_VIEWS: Conversation = {
  actions: [
    { pick: 'calendar-main/showWeek' },
    {
      pick: 'calendar-main/addEvent',
      params: { title: { value: 'standup' }, time: 'stated_elsewhere' },
    },
  ],
  confidence: 0.7,
};

describe('batchedActions', () => {
  test('asks one question per reachable variant state and depth, deduplicated', async () => {
    const { calls } = await run(
      batchedActions,
      selectionOf('show the week', CALENDAR_AND_WEATHER),
      conversation({}),
    );
    const ids = Object.keys(calls[0]?.questions ?? {});
    const atDepth = (depth: number) =>
      ids.filter((id) => id.startsWith(`action/${depth}@`)).sort();
    expect(ids[0]).toBe('action/0');
    expect(atDepth(1)).toEqual([
      'action/1@calendar-main:day',
      'action/1@calendar-main:week',
      'action/1@same',
      'action/1@weather-main:weekly',
    ]);
    expect(atDepth(2)).toEqual([
      'action/2@calendar-main:day',
      'action/2@calendar-main:day,weather-main:weekly',
      'action/2@calendar-main:week',
      'action/2@calendar-main:week,weather-main:weekly',
      'action/2@same',
      'action/2@weather-main:weekly',
    ]);
    expect(atDepth(MAX_ACTIONS)).toHaveLength(6);
    expect(ids.length).toBeLessThanOrEqual(MAX_BATCH_QUESTIONS);
    expect(calls).toHaveLength(1);
  });

  test('a transition at step 0 reads the question for the new state, which offers its actions', async () => {
    const script: Script = (payload) => {
      const ids = Object.keys(payload.questions);
      if (ids.includes('action/0')) {
        const choices: Record<string, string> = {};
        for (const id of ids) choices[id] = 'done';
        choices['action/0'] = keyOf(payload, 'action/0', 'showWeek');
        choices['action/1@same'] = 'unsupported';
        choices['action/1@calendar-main:week'] = keyOf(
          payload,
          'action/1@calendar-main:week',
          'week: addEvent',
        );
        return { choices };
      }
      return {
        choices: {
          'param/1/title': 'stated_elsewhere',
          'param/1/time': 'stated_elsewhere',
        },
      };
    };
    const { result, calls } = await run(
      batchedActions,
      selectionOf('week view, then add standup', CALENDAR_AND_WEATHER),
      script,
    );
    expect(
      Object.values(
        calls[0]?.questions['action/1@calendar-main:week']?.criteria ?? {},
      ),
    ).toContain(
      'calendar-main, currently week: showMonth. Switch back to month view Switches it to its month view.',
    );
    expect(planned(result).actions).toMatchObject([
      { instanceId: 'calendar-main', action: 'showWeek' },
      { instanceId: 'calendar-main', action: 'addEvent' },
    ]);
    expect(calls).toHaveLength(2);
  });

  test.each([0, 1, 3])('stops at done after %i actions', async (count) => {
    const picks = [
      { pick: 'calendar-main/showWeek' },
      { pick: 'weather-main/showWeekly' },
      { pick: 'calendar-main/showMonth' },
    ].slice(0, count);
    const { result, calls } = await run(
      batchedActions,
      selectionOf('views', CALENDAR_AND_WEATHER),
      conversation({ actions: picks }),
    );
    expect(planned(result).actions.map((a) => a.action)).toEqual(
      picks.map((pick) => pick.pick.split('/')[1]),
    );
    expect(calls).toHaveLength(1);
  });

  test('matches stepwise on the answers it consumes, with one parameter call', async () => {
    const selection = selectionOf('week view, then add standup');
    const stepwise = await run(
      stepwiseActions,
      selection,
      conversation(TWO_VIEWS),
    );
    const batched = await run(
      batchedActions,
      selection,
      conversation(TWO_VIEWS),
    );
    expect(planned(batched.result)).toEqual(planned(stepwise.result));
    expect(batched.calls).toHaveLength(2);
    expect(Object.keys(batched.calls[1]?.questions ?? {})).toEqual([
      'param/1/title',
      'param/1/time',
    ]);
    expect(isOk(batched.result) && batched.result.value.minConfidence).toBe(
      0.7,
    );
  });

  test('beyond the question cap the remaining depth runs one call per step', async () => {
    const script = conversation({
      actions: [
        { pick: 'calendar-main/showWeek' },
        { pick: 'weather-main/showWeekly' },
        { pick: 'calendar-main/showMonth' },
      ],
    });
    const selection = selectionOf('views', CALENDAR_AND_WEATHER);
    const { ask, calls } = scriptedAsk(script);
    const result = await batchedActions(ask, { maxQuestions: 5 })(
      selection,
      makeContext(selection.input),
    );
    expect(Object.keys(calls[0]?.questions ?? {})).toHaveLength(5);
    expect(calls.slice(1).map((call) => Object.keys(call.questions))).toEqual([
      ['action/2@calendar-main:week,weather-main:weekly'],
      ['action/3@weather-main:weekly'],
    ]);
    expect(calls[1]?.state.previousActions).toEqual([
      { instanceId: 'calendar-main', action: 'showWeek' },
      { instanceId: 'weather-main', action: 'showWeekly' },
    ]);
    expect(planned(result).actions.map((a) => a.action)).toEqual([
      'showWeek',
      'showWeekly',
      'showMonth',
    ]);
  });

  test('defers batch_cap when not even the first question fits', async () => {
    const selection = selectionOf('views');
    const { ask, calls } = scriptedAsk(conversation({}));
    const result = await batchedActions(ask, { maxQuestions: 0 })(
      selection,
      makeContext(selection.input),
    );
    expect(deferralOf(result)).toBe('jevActions/batch_cap');
    expect(calls).toEqual([]);
  });

  test('defers an unsupported answer on the walked path and a fifth action', async () => {
    const unsupported = await run(
      batchedActions,
      selectionOf('fly', CALENDAR_AND_WEATHER),
      conversation({ actions: [{ pick: 'unsupported' }] }),
    );
    expect(deferralOf(unsupported.result)).toBe(
      'jevActions/action_unsupported',
    );
    const tooMany = await run(
      batchedActions,
      selectionOf('flip', CALENDAR_AND_WEATHER),
      conversation({
        actions: Array.from({ length: MAX_ACTIONS + 1 }, (_, i) => ({
          pick:
            i % 2 === 0 ? 'calendar-main/showWeek' : 'calendar-main/showMonth',
        })),
      }),
    );
    expect(deferralOf(tooMany.result)).toBe('jevActions/action_limit');
  });

  test('drops an action whose parameter is not stated and asks for it', async () => {
    const { result } = await run(
      batchedActions,
      selectionOf('set the weather'),
      conversation({
        actions: [
          {
            pick: 'weather-main/setLocation',
            params: { location: 'not_stated' },
          },
        ],
      }),
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

  test('makes no call on a resize-only turn or when the gate says no actions are needed', async () => {
    const needsActions: GateAnswer = {
      answer: 'no',
      probability: 0.2,
      confidence: 0.6,
    };
    const gated: Selection2 = {
      ...selectionOf('put the map left'),
      gates: { needsActions },
    };
    for (const selection of [gated, keepAll(makeResizeRequest(12, 20))]) {
      const { result, calls } = await run(
        batchedActions,
        selection,
        conversation({}),
      );
      expect(calls).toEqual([]);
      expect(planned(result)).toEqual({ actions: [], asks: [] });
      expect(isOk(result) && result.value.minConfidence).toBe(1);
    }
    const { result } = await run(batchedActions, gated, conversation({}));
    expect(isOk(result) && result.value.gates).toEqual({ needsActions });
  });

  test('asks when the gate says yes', async () => {
    const selection: Selection2 = {
      ...selectionOf('week view'),
      gates: {
        needsActions: { answer: 'yes', probability: 0.9, confidence: 0.8 },
      },
    };
    const { calls } = await run(batchedActions, selection, conversation({}));
    expect(calls).toHaveLength(1);
  });
});

function keyOf(
  payload: Parameters<Script>[0],
  id: string,
  text: string,
): string {
  const found = Object.entries(payload.questions[id]?.criteria ?? {}).find(
    ([, description]) => description.includes(text),
  );
  if (!found) throw new Error(`no option of ${id} mentions ${text}`);
  return found[0];
}
