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
  plain,
} from '../__test-helpers__/fixtures.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import type { Ask } from '../typesafe-client.js';
import { actionsBatched } from './actions-batched.js';
import { actionsBatchedPerInstance } from './actions-batched-per-instance.js';
import { actionsStepwise } from './actions-stepwise.js';
import type { ActionsStage } from './types.js';

const STAGES: Readonly<Record<string, (ask: Ask) => ActionsStage>> = {
  stepwise: actionsStepwise,
  batched: actionsBatched,
  perInstance: actionsBatchedPerInstance,
};

const CASES: readonly (readonly [string, string, Conversation])[] = [
  ['no action', 'hide the tasks', {}],
  [
    'one bound parameter',
    'show the weather in "Tokyo"',
    {
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: { value: 'Tokyo' } },
        },
      ],
    },
  ],
  [
    'a transition then an action of the new view, stated elsewhere',
    'week view, then add the meeting from my email',
    {
      actions: [
        { pick: 'calendar-main/showWeek' },
        {
          pick: 'calendar-main/addEvent',
          params: { title: 'stated_elsewhere', time: 'stated_elsewhere' },
        },
      ],
    },
  ],
  [
    'an optional parameter omitted',
    'add task "Call mum"',
    {
      actions: [
        {
          pick: 'tasks-main/addTask',
          params: { title: { value: 'Call mum' }, urgent: 'omit' },
        },
      ],
    },
  ],
  [
    'a parameter not stated',
    'set the weather location',
    {
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: 'not_stated' },
        },
      ],
    },
  ],
  [
    'actions on two instances in selection order',
    'week view and weather in "Oslo"',
    {
      actions: [
        { pick: 'calendar-main/showWeek' },
        {
          pick: 'weather-main/setLocation',
          params: { location: { value: 'Oslo' } },
        },
      ],
    },
  ],
];

describe('actions stages on the same scripted conversations', () => {
  for (const [name, intent, script] of CASES)
    test(`${name}: every stage plans the same actions and asks`, async () => {
      const selection = keepAll(makeRequest(intent));
      const plans: Record<string, unknown> = {};
      for (const [stage, build] of Object.entries(STAGES)) {
        const { ask } = scriptedAsk(conversation(script));
        const result = await build(ask)(
          selection,
          makeContext(selection.input),
        );
        if (!isOk(result))
          throw new Error(`${stage} deferred ${deferralOf(result)}`);
        plans[stage] = plain({
          actions: result.value.actions,
          asks: result.value.asks,
        });
      }
      expect(plans.batched).toEqual(plans.stepwise);
      expect(plans.perInstance).toEqual(plans.stepwise);
    });

  test('call counts: stepwise one per step and binding, batched two, per-instance one', async () => {
    const [, intent, script] = CASES[2] as (typeof CASES)[number];
    const selection = keepAll(makeRequest(intent));
    const counts: Record<string, number> = {};
    for (const [stage, build] of Object.entries(STAGES)) {
      const { ask, calls } = scriptedAsk(conversation(script));
      await build(ask)(selection, makeContext(selection.input));
      counts[stage] = calls.length;
    }
    expect(counts).toEqual({ stepwise: 4, batched: 2, perInstance: 1 });
  });
});
