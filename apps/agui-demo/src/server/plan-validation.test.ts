import { expect, test } from 'bun:test';

import { Orchestrator } from '@maelstrom-co/client';
import {
  createEngine,
  type PlanningInput,
  type Retryable,
} from '@maelstrom-co/engine';
import {
  ActionName,
  ChartRequestMessage,
  ChartRequestSchema,
  getVisibleInstanceIds,
  InstanceId,
  isOk,
  ok,
  SessionId,
  TilingResponseSchema,
  VariantName,
} from '@maelstrom-co/protocol';
import { journalVessel, tasksVessel } from '../vessels/definitions';
import { IssuedPlans } from './issued-plans';
import { validateWorkspacePlan } from './plan-validation';

const target = InstanceId('journal-new');
const task = { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' };
const journal = { instanceId: target, vesselId: 'journal', variant: 'entry' };
const request = ChartRequestSchema.parse({
  type: 'chart_request',
  context: {
    updateReasons: [{ type: 'user_intent', intent: 'Create an entry' }],
    chartDimensions: { rows: 10, columns: 21 },
    layoutMode: 'tiling',
  },
  instances: [task],
  vessels: [journalVessel, tasksVessel],
  layout: { type: 'tiling', tree: ['ID:tasks-main'], instances: [task] },
});
function candidate(visible: boolean, actions = true) {
  return TilingResponseSchema.parse({
    type: 'plan',
    userMessage: 'Create an entry.',
    rationale: 'Retain Tasks and introduce Journal.',
    layout: {
      tree: [visible ? `ID:${target}` : 'ID:tasks-main'],
      instances: [task, journal],
    },
    executionPlan: actions
      ? [
          {
            instanceId: target,
            action: 'createEntry',
            paramsJson: JSON.stringify({ title: 'Notes', date: '2026-11-07' }),
          },
        ]
      : [],
  });
}
const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('a new hidden Action target is repaired before issuance so its handler can mount', async () => {
  let attempts = 0;
  const engine = createEngine({
    logger,
    retry: { max: 1 },
    validatePlan: validateWorkspacePlan,
    planner: async (input: Retryable<PlanningInput>) => {
      attempts++;
      return ok(candidate(!!input.retry));
    },
  });
  const result = await engine.handle(
    ChartRequestMessage({ sessionId: SessionId(), request }),
  );
  expect(isOk(result)).toBe(true);
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error('Expected a repaired response');
  expect([...getVisibleInstanceIds(result.value.response.layout)]).toContain(
    target,
  );
  expect(attempts).toBe(2);
  const plans = new IssuedPlans();
  plans.issue(result.value.response, request, {
    id: 'tool',
    intent: 'Create an entry',
  });
  plans.execute(result.value.response.requestId, 0);
  expect(plans.snapshot().journal).toHaveLength(1);
});

test('an unresolved hidden target exhausts only the planning budget and never reaches execution', async () => {
  let attempts = 0;
  const engine = createEngine({
    logger,
    retry: { max: 1 },
    validatePlan: validateWorkspacePlan,
    planner: async () => {
      attempts++;
      return ok(candidate(false));
    },
  });
  const result = await engine.handle(
    ChartRequestMessage({ sessionId: SessionId(), request }),
  );
  expect(result).toMatchObject({ ok: false, error: { field: 'validatePlan' } });
  expect(attempts).toBe(2);
});

test('retained hidden Instances can still receive Actions and new hidden Instances can be retained without Actions', async () => {
  for (const retained of [true, false]) {
    const current = retained
      ? ChartRequestSchema.parse({
          ...request,
          instances: [task, journal],
          layout: { ...request.layout, instances: [task, journal] },
        })
      : request;
    const engine = createEngine({
      logger,
      retry: false,
      validatePlan: validateWorkspacePlan,
      planner: async () => ok(candidate(false, retained)),
    });
    const result = await engine.handle(
      ChartRequestMessage({ sessionId: SessionId(), request: current }),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.value.type !== 'chart_response')
      throw new Error('Expected supported hidden Instances');
    expect([
      ...getVisibleInstanceIds(result.value.response.layout),
    ]).not.toContain(target);
    const plans = new IssuedPlans();
    plans.issue(result.value.response, current, {
      id: 'tool',
      intent: 'Create an entry',
    });
    if (retained) {
      plans.execute(result.value.response.requestId, 0);
      expect(plans.snapshot().journal).toHaveLength(1);
    } else expect(plans.snapshot().journal).toEqual([]);
  }
});

test('a new hidden target cannot be issued even when an injected Engine omits application validation', async () => {
  const engine = createEngine({
    logger,
    retry: false,
    planner: async () => ok(candidate(false)),
  });
  const result = await engine.handle(
    ChartRequestMessage({ sessionId: SessionId(), request }),
  );
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error('Expected the unguarded candidate');
  const response = result.value.response;
  const plans = new IssuedPlans();
  expect(() =>
    plans.issue(response, request, {
      id: 'tool',
      intent: 'Create an entry',
    }),
  ).toThrow('visible');
  expect(plans.review()).toEqual([]);
  expect(plans.snapshot().journal).toEqual([]);
});
