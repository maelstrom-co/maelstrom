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

import { WorkspaceConnector } from '../browser/workspace-connector';
import {
  calendarVessel,
  journalVessel,
  tasksVessel,
} from '../vessels/definitions';
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

function journalListCandidate() {
  const response = candidate(true);
  return TilingResponseSchema.parse({
    ...response,
    layout: {
      ...response.layout,
      instances: [task, { ...journal, variant: 'list' }],
    },
  });
}

test('a pre-action list Layout creates the record before transitioning to entry for the dependent append', async () => {
  const engine = createEngine({
    logger,
    retry: false,
    validatePlan: validateWorkspacePlan,
    planner: async () => ok(journalListCandidate()),
  });
  const result = await engine.handle(
    ChartRequestMessage({ sessionId: SessionId(), request }),
  );
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error('Expected a pre-action Journal Layout');
  expect(result.value.response.layout).toMatchObject({
    instances: [task, { ...journal, variant: 'list' }],
  });
  expect(result.value.response.executionPlan).toHaveLength(1);
  const plans = new IssuedPlans();
  plans.issue(result.value.response, request, {
    id: 'create',
    intent: 'Create an entry',
  });
  const response = result.value.response;
  const client = new Orchestrator(new WorkspaceConnector(async () => []), {
    vessels: [journalVessel, tasksVessel],
  });
  client.commandProcessor.registerRunner(target, {
    createEntry: () => {
      expect(
        client
          .getStructuralSnapshot()
          .instances.find((instance) => instance.instanceId === target)
          ?.variant,
      ).toBe(VariantName('list'));
      plans.execute(response.requestId, 0);
      return ok(undefined);
    },
  });
  try {
    const settlement = await client.commandProcessor.dispatchSettled(
      { kind: 'set_layout', layout: response.layout },
      { kind: 'execute_actions', executionPlan: response.executionPlan },
    );
    expect(settlement.status).toBe('applied');
    expect(plans.snapshot().journal).toHaveLength(1);
    expect(
      client
        .getStructuralSnapshot()
        .instances.find((instance) => instance.instanceId === target)?.variant,
    ).toBe(VariantName('entry'));
  } finally {
    await client.dispose();
  }
});

test('issuance rejects an Action unavailable in the pre-action Layout before committing a record', async () => {
  const engine = createEngine({
    logger,
    retry: false,
    planner: async () => ok(journalListCandidate()),
  });
  const result = await engine.handle(
    ChartRequestMessage({ sessionId: SessionId(), request }),
  );
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error('Expected the unguarded transition');
  const response = {
    ...result.value.response,
    executionPlan: [
      {
        instanceId: target,
        action: ActionName('writeContent'),
        paramsJson: '{}',
      },
    ],
  };
  const plans = new IssuedPlans();
  expect(() =>
    plans.issue(response, request, {
      id: 'create',
      intent: 'Create an entry',
    }),
  ).toThrow('Layout Variant');
  expect(plans.review()).toEqual([]);
  expect(plans.snapshot().journal).toEqual([]);
});

test('retained transitions start from the response Layout even when the observed Variant differs', async () => {
  const calendar = {
    instanceId: 'calendar-main',
    vesselId: 'calendar',
    variant: 'week',
  };
  const current = ChartRequestSchema.parse({
    ...request,
    context: {
      ...request.context,
      updateReasons: [{ type: 'user_intent', intent: 'Show Calendar week.' }],
    },
    instances: [calendar],
    vessels: [calendarVessel],
    layout: {
      type: 'tiling',
      tree: ['ID:calendar-main'],
      instances: [calendar],
    },
  });
  for (const variant of ['day', 'month']) {
    let attempts = 0;
    const engine = createEngine({
      logger,
      retry: { max: 1 },
      validatePlan: validateWorkspacePlan,
      planner: async () => {
        attempts++;
        return ok(
          TilingResponseSchema.parse({
            type: 'plan',
            userMessage: 'Show Calendar week.',
            rationale: 'Transition a retained Instance.',
            layout: {
              tree: ['ID:calendar-main'],
              instances: [{ ...calendar, variant }],
            },
            executionPlan: [
              {
                instanceId: 'calendar-main',
                action: 'showWeek',
                paramsJson: '{}',
              },
            ],
          }),
        );
      },
    });
    const result = await engine.handle(
      ChartRequestMessage({ sessionId: SessionId(), request: current }),
    );
    expect(result.ok).toBe(true);
    expect(attempts).toBe(1);
    if (!result.ok || result.value.type !== 'chart_response')
      throw new Error('Expected a valid transition');
    expect(result.value.response.executionPlan).toHaveLength(1);
    expect(result.value.response.layout).toMatchObject({
      instances: [{ ...calendar, variant }],
    });
    const plans = new IssuedPlans();
    plans.issue(result.value.response, current, {
      id: 'show-week',
      intent: 'Show Calendar week.',
    });
    expect(plans.review()).toHaveLength(1);
  }
});

test('layout-only changes do not require a synthetic transition Action', async () => {
  const engine = createEngine({
    logger,
    retry: false,
    validatePlan: validateWorkspacePlan,
    planner: async () => ok(candidate(true, false)),
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId(),
      request: ChartRequestSchema.parse({
        ...request,
        instances: [task, { ...journal, variant: 'list' }],
        layout: {
          ...request.layout,
          instances: [task, { ...journal, variant: 'list' }],
        },
      }),
    }),
  );
  expect(result.ok).toBe(true);
});
