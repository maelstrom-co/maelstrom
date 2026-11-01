import type { Planner, PlanningInput, Retryable } from '@maelstrom-co/engine';
import { ok, TilingResponseSchema } from '@maelstrom-co/protocol';
import { describe, expect, it, vi } from 'vitest';

import { OperationSchema, PlanSchema } from '../lib/agui-contract';
import { journalVessel } from '../vessels/journal.vessel.def';
import { createAgentEngine, DemoAgentEngine } from './agui-engine';

const model = vi.hoisted(() => ({ planner: null as Planner | null }));
vi.mock('@maelstrom-co/planner-llm', () => ({
  llmPlanner: () => model.planner,
}));

const candidate = (variant: 'list' | 'entry', extraAction = false) =>
  TilingResponseSchema.parse({
    type: 'plan',
    userMessage: 'Create the Journal entry.',
    rationale: 'Model response fixture.',
    layout: {
      tree: ['ID:journal-live'],
      instances: [{ instanceId: 'journal-live', vesselId: 'journal', variant }],
    },
    executionPlan: Array.from({ length: extraAction ? 2 : 1 }, () => ({
      instanceId: 'journal-live',
      action: 'createEntry',
      paramsJson: JSON.stringify({ title: 'Live proof' }),
    })),
  });

const operation = () =>
  OperationSchema.parse({
    kind: 'plan',
    revision: 0,
    goal: { id: 'goal', title: 'Live proof' },
    journal: { activeEntryId: null, entries: [] },
    message: {
      type: 'chart_request',
      sessionId: 'session',
      id: 'request',
      timestamp: 1,
      request: {
        type: 'chart_request',
        context: {
          layoutMode: 'tiling',
          chartDimensions: { rows: 8, columns: 12 },
          updateReasons: [{ type: 'user_intent', intent: 'Create the entry' }],
        },
        vessels: [journalVessel],
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      },
    },
  });

describe('bounded live Planner requirements', () => {
  const resizeOperation = () =>
    OperationSchema.parse({
      ...operation(),
      goal: undefined,
      message: {
        type: 'chart_request',
        sessionId: 'session',
        id: 'resize',
        timestamp: 2,
        request: {
          type: 'chart_request',
          context: {
            layoutMode: 'tiling',
            chartDimensions: { rows: 6, columns: 10 },
            updateReasons: [
              {
                type: 'chart_resize',
                previous: { rows: 8, columns: 12 },
                current: { rows: 6, columns: 10 },
              },
            ],
          },
          vessels: [journalVessel],
          instances: [
            {
              instanceId: 'journal-live',
              vesselId: 'journal',
              variant: 'entry',
            },
            {
              instanceId: 'journal-hidden',
              vesselId: 'journal',
              variant: 'list',
            },
          ],
          layout: {
            type: 'tiling',
            tree: ['ID:journal-live'],
            instances: [
              {
                instanceId: 'journal-live',
                vesselId: 'journal',
                variant: 'entry',
              },
              {
                instanceId: 'journal-hidden',
                vesselId: 'journal',
                variant: 'list',
              },
            ],
          },
        },
      },
    });

  it.each(['clear', 'hide', 'drop retained', 'change variant'])(
    'refuses an automatic live candidate that would %s the Journal workspace',
    async (change) => {
      const resize = resizeOperation();
      if (resize.kind !== 'plan') throw new Error('Expected plan');
      const layout = TilingResponseSchema.shape.layout.parse(
        resize.message.request.layout,
      );
      if (change === 'clear') {
        layout.tree = [];
        layout.instances = [];
      } else if (change === 'hide') {
        layout.tree = [];
      } else if (change === 'drop retained') {
        layout.instances.pop();
      } else {
        layout.instances[0] = {
          ...layout.instances[0]!,
          variant: layout.instances[1]!.variant,
        };
      }
      const planner = vi.fn<Planner>(async () =>
        ok(
          TilingResponseSchema.parse({
            ...candidate('entry'),
            layout,
            executionPlan: [],
          }),
        ),
      );
      model.planner = planner;
      const session = new DemoAgentEngine(
        'session',
        createAgentEngine('live', 'test-key'),
      );
      await expect(session.run('resize', resize)).rejects.toThrow(
        'Experimental planning failed',
      );
      expect(planner).toHaveBeenCalledTimes(2);
      expect(session.state.phase).toBe('stopped');
      expect(session.state.revision).toBe(0);
    },
  );

  it('allows resize geometry changes while preserving visible and retained Instances', async () => {
    const resize = resizeOperation();
    if (resize.kind !== 'plan') throw new Error('Expected plan');
    model.planner = async () =>
      ok(
        TilingResponseSchema.parse({
          ...candidate('entry'),
          layout: {
            tree: ['V:2,1', 'ID:journal-live', null],
            instances: [...resize.message.request.instances].reverse(),
          },
          executionPlan: [],
        }),
      );
    const session = new DemoAgentEngine(
      'session',
      createAgentEngine('live', 'test-key'),
    );
    const plan = PlanSchema.parse(await session.run('resize', resize));
    expect(plan.response.layout.tree).toEqual([
      'V:2,1',
      'ID:journal-live',
      null,
    ]);
    expect(plan.response.layout.instances).toHaveLength(2);
    expect(plan.response.executionPlan).toEqual([]);
  });

  it('repairs a list-variant create candidate before emitting the only application write', async () => {
    const attempts: Retryable<PlanningInput>[] = [];
    model.planner = async (input: Retryable<PlanningInput>) => {
      attempts.push(input);
      return ok(candidate(input.retry ? 'entry' : 'list'));
    };
    const session = new DemoAgentEngine(
      'session',
      createAgentEngine('live', 'test-key'),
    );
    const plan = PlanSchema.parse(await session.run('run', operation()));
    expect(attempts).toHaveLength(2);
    expect(attempts[1]?.retry?.diagnostics.planIssues?.[0]?.message).toContain(
      'entry',
    );
    expect(plan.response.layout.instances[0]?.variant).toBe('entry');
    expect(plan.response.executionPlan).toHaveLength(1);
    expect(session.state.phase).toBe('create');
    expect(session.state.observedId).toBeNull();
    await expect(
      session.run('early-continuation', operation()),
    ).rejects.toThrow('Pending application');
  });

  it('stops after one pre-delivery correction when the model keeps proposing duplicate writes', async () => {
    const planner = vi.fn<Planner>(async () => ok(candidate('entry', true)));
    model.planner = planner;
    const session = new DemoAgentEngine(
      'session',
      createAgentEngine('live', 'test-key'),
    );
    await expect(session.run('run', operation())).rejects.toThrow(
      'Experimental planning failed',
    );
    expect(planner).toHaveBeenCalledTimes(2);
    expect(session.state.phase).toBe('stopped');
    expect(session.state.observedId).toBeNull();
  });
});
