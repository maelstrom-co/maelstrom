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
