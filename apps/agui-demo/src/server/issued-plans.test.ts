import { expect, test } from 'bun:test';

import {
  ChartRequestSchema,
  MaelstromResponseMessageSchema,
} from '@maelstrom-co/protocol';

import { IssuedPlans } from './issued-plans';

const request = ChartRequestSchema.parse({
  type: 'chart_request',
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'Create entry' }],
    chartDimensions: { rows: 8, columns: 12 },
    layoutMode: 'tiling',
  },
  vessels: [],
  instances: [],
  layout: { type: 'tiling', tree: [], instances: [] },
});
const tool = { id: 'tool-1', intent: 'Create entry' };
const automatic = {
  ...request,
  context: { ...request.context, updateReasons: [] },
};
function response(
  id: string,
  actions = [
    {
      instanceId: 'journal',
      action: 'createEntry',
      params: { title: 'One note', date: '2026-11-06' },
    },
  ],
) {
  return MaelstromResponseMessageSchema.parse({
    type: 'engine.maelstrom.response',
    requestId: id,
    response: {
      type: 'maelstrom_response',
      requestId: id,
      userMessage: '',
      rationale: '',
      layout: {
        type: 'tiling',
        tree: ['ID:journal'],
        instances: [
          { instanceId: 'journal', vesselId: 'journal', variant: 'entry' },
        ],
      },
      executionPlan: actions,
    },
  }).response;
}

test('an issued indexed operation commits once and its receipt agrees with the record', () => {
  const store = new IssuedPlans();
  store.issue(response('request-1'), request, tool);
  expect(store.snapshot().journal).toEqual([]);
  expect(() => store.execute('request-1', 1)).toThrow('not issued');
  const committed = store.execute('request-1', 0);
  const duplicate = store.execute('request-1', 0);
  expect(duplicate).toEqual(committed);
  expect(store.snapshot().journal).toHaveLength(1);
  expect(store.snapshot().revision).toBe(1);
  store.settle('request-1', 'applied', 'tool-1');
  expect(store.execute('request-1', 0)).toEqual(committed);
  expect(store.snapshot().revision).toBe(1);
  expect(() => store.execute('request-1', 1)).toThrow('not issued');
  expect(() => store.confirmed('request-1', 'tool-1')).toThrow('not confirmed');
  expect(() => store.confirmed('request-1', 'another-tool')).toThrow(
    'not confirmed',
  );
});

test('automatic requests and multi-effect plans cannot authorize writes', () => {
  const store = new IssuedPlans();
  expect(() => store.issue(response('auto'), automatic)).toThrow('Automatic');
  expect(() => store.issue(response('stale'), automatic, tool)).toThrow(
    'tool admission',
  );
  expect(() =>
    store.issue(response('wrong-intent'), request, {
      ...tool,
      intent: 'Different intent',
    }),
  ).toThrow('tool admission');
  const plan = response('two');
  expect(() =>
    store.issue(
      {
        ...plan,
        executionPlan: [...plan.executionPlan, ...plan.executionPlan],
      },
      request,
      tool,
    ),
  ).toThrow('separate');
  expect(store.snapshot().journal).toEqual([]);
});

test('a browser success claim without a committed receipt cannot advance the goal', () => {
  const store = new IssuedPlans();
  store.issue(response('request-1'), request, tool);
  expect(() => store.settle('request-1', 'applied', 'tool-1')).toThrow(
    'not confirmed',
  );
  expect(() => store.execute('request-1', 0)).toThrow('not issued');
  expect(store.snapshot().journal).toEqual([]);
});

test('uncertain application preserves committed records but prevents later writes and continuation', () => {
  const store = new IssuedPlans();
  store.issue(response('request-1'), request, tool);
  store.execute('request-1', 0);
  expect(() => store.settle('request-1', 'unknown', 'tool-1')).toThrow(
    'not confirmed',
  );
  expect(() =>
    store.issue(response('request-2'), request, { ...tool, id: 'tool-2' }),
  ).toThrow('cannot be issued');
  expect(() => store.confirmed('request-1', 'tool-1')).toThrow('not confirmed');
  expect(store.snapshot().journal).toHaveLength(1);
});

test('a mismatched application acknowledgment fences even an unexecuted issued write', () => {
  const store = new IssuedPlans();
  store.issue(response('request-1'), request, tool);
  expect(() => store.settle('request-1', 'unknown', 'wrong-tool')).toThrow(
    'does not match',
  );
  expect(() => store.execute('request-1', 0)).toThrow('not issued');
  expect(() => store.settle('request-1', 'applied', tool.id)).toThrow(
    'does not match',
  );
  expect(store.snapshot().journal).toEqual([]);
});
