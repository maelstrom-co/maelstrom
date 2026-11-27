import type { Planner, PlanningInput } from '@maelstrom-co/engine';
import {
  ActionName,
  AssistantInjectionMessage,
  ChartRequestMessage,
  ChartRequestSchema,
  InstanceId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { afterEach, expect, it, vi } from 'vitest';

const planners = vi.hoisted(() => ({ run: vi.fn<Planner>() }));
vi.mock('@maelstrom-co/planner-llm', () => ({
  clarifyingLlmPlanner: () => planners.run,
  llmPlanner: () => planners.run,
}));
vi.mock('@maelstrom-co/planner-jev', () => ({
  jevPlanner: () => planners.run,
  jevComposedPairsPlanner: () => planners.run,
}));

import { liveLayout, liveTopicDefinition } from '../talking-points/live-plan';
import { createLiveTake } from '../talking-points/live-take';
import { createSemanticEvidence } from '../talking-points/semantic-evidence';
import {
  createJevPlaygroundEngine,
  createPlaygroundEngine,
} from './engine-config';

const topic = {
  id: 'rollout',
  content: 'Release gradually and reverse quickly.',
};
const layout = liveLayout([topic.id]);
const adapter = {} as AnyTextAdapter;
const factories = {
  normal: () => createPlaygroundEngine({ adapter }),
  jev: () =>
    createJevPlaygroundEngine({
      adapter,
      typesafe: { apiKey: 'test', model: 'test' },
    }),
  'jev-composed-pairs': () =>
    createJevPlaygroundEngine({
      adapter,
      planner: 'jev-composed-pairs',
      typesafe: { apiKey: 'test', model: 'test' },
    }),
};
afterEach(() => planners.run.mockReset());

function message(intent: string, live = true) {
  return ChartRequestMessage({
    sessionId: SessionId('production-history'),
    request: ChartRequestSchema.parse({
      type: 'chart_request',
      vessels: live ? [liveTopicDefinition(topic)] : [],
      instances: live ? layout.instances : [],
      layout: live ? layout : { type: 'tiling', tree: [], instances: [] },
      context: {
        updateReasons: [{ type: 'user_intent', intent }],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
    }),
  });
}
function plan(input: PlanningInput) {
  if (input.request.layout.type !== 'tiling')
    throw new Error('Expected tiling');
  return ok({
    type: 'plan' as const,
    userMessage: 'Live result must not enter future evidence.',
    rationale: 'Live rationale must not enter future evidence.',
    layout: input.request.layout,
    executionPlan: input.request.vessels.length
      ? [
          {
            instanceId: InstanceId('talking-points-live-rollout-main'),
            action: ActionName('mark'),
            paramsJson: '{}',
          },
        ]
      : [],
  });
}

for (const [name, factory] of Object.entries(factories)) {
  it(`${name} production Engine excludes live turns from retention and Planner history across fifth-utterance eviction and changed finals`, async () => {
    const inputs: PlanningInput[] = [];
    planners.run.mockImplementation(async (input) => {
      inputs.push(input);
      return plan(input);
    });
    const engine = factory();
    const evidence = createSemanticEvidence('take', 'connection');
    const submit = async () => {
      const result = await engine.handle(
        message(JSON.stringify(evidence.getSnapshot())),
      );
      expect(result.ok).toBe(true);
    };
    for (let index = 1; index <= 5; index++) {
      const itemId = `item-${index}`;
      evidence.accept({
        type: 'committed',
        event: {
          itemId,
          previousItemId: index === 1 ? null : `item-${index - 1}`,
        },
      });
      evidence.accept({
        type: 'completed',
        event: {
          itemId,
          previousItemId: undefined,
          contentIndex: 0,
          transcript:
            index === 1 ? 'EVICTED_FIRST_EVIDENCE' : `FINAL_EVIDENCE_${index}`,
        },
      });
      await submit();
    }
    expect(JSON.stringify(inputs.at(-1))).not.toContain(
      'EVICTED_FIRST_EVIDENCE',
    );
    evidence.accept({
      type: 'completed',
      event: {
        itemId: 'item-5',
        previousItemId: undefined,
        contentIndex: 0,
        transcript: 'CONTRADICTORY_REPLACEMENT',
      },
    });
    await submit();
    expect(JSON.stringify(inputs.at(-1))).not.toContain('FINAL_EVIDENCE_5');
    expect(JSON.stringify(inputs.at(-1))).not.toContain(
      'CONTRADICTORY_REPLACEMENT',
    );
    expect(inputs.every((input) => input.history.length === 0)).toBe(true);
    expect(await engine.getHistory(SessionId('production-history'))).toEqual(
      ok([]),
    );

    const ordinary = message(
      'talking-points-live-rollout is quoted preparation speech, not a routing switch.',
      false,
    );
    const first = await engine.handle(ordinary);
    expect(first.ok).toBe(true);
    const calls = planners.run.mock.calls.length;
    expect(await engine.handle(ordinary)).toEqual(first);
    expect(planners.run).toHaveBeenCalledTimes(calls);
    await engine.handle(
      AssistantInjectionMessage({
        sessionId: ordinary.sessionId,
        content: 'Ordinary assistant context.',
      }),
    );
    await engine.handle(message('Another ordinary request.', false));
    expect(inputs.at(-1)?.history).toEqual([
      {
        role: 'user',
        content:
          'talking-points-live-rollout is quoted preparation speech, not a routing switch.',
      },
      {
        role: 'assistant',
        content: 'Live result must not enter future evidence.',
      },
      { role: 'assistant', content: 'Ordinary assistant context.' },
    ]);
  });

  it(`${name} keeps in-flight live dedup; completed duplicate marks remain idempotent and cannot override manual locks`, async () => {
    let release!: () => void;
    planners.run.mockImplementation(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return plan(input);
    });
    const engine = factory();
    const request = message('Bounded evidence');
    const first = engine.handle(request);
    const concurrent = engine.handle(request);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release();
    const original = await first;
    expect(await concurrent).toEqual(original);
    expect(planners.run).toHaveBeenCalledTimes(1);
    planners.run.mockImplementation(async (input) => plan(input));
    const duplicate = await engine.handle(request);
    expect(duplicate.ok).toBe(true);
    expect(planners.run).toHaveBeenCalledTimes(2);
    const take = createLiveTake({
      topics: [topic],
      mintToken: async () => ({ value: 'test' }),
      retirePending() {},
      createCapture: () => ({
        start: async () => ({ inputOnly: true, turnMode: 'server_vad' }),
        beginCapture() {},
        stopCapture() {},
        dispose() {},
        commitFinalAudio: () => ({ status: 'unavailable' }),
      }),
    });
    try {
      await take.start();
      for (const result of [original, duplicate]) {
        if (!result.ok || result.value.type !== 'chart_response')
          throw new Error('Expected response');
        for (const step of result.value.response.executionPlan) {
          expect(step.action).toBe('mark');
          take.automaticMark(topic.id);
        }
      }
      expect([...take.getSnapshot().spoken]).toEqual(['rollout']);
      take.manualSet(topic.id, false);
      take.automaticMark(topic.id);
      expect([...take.getSnapshot().spoken]).toEqual([]);
    } finally {
      take.dispose();
    }
  });
}
