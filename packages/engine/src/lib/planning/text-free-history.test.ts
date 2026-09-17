import { describe, expect, test } from 'bun:test';
import {
  ChartRequestMessage,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import {
  createEngine,
  createInMemoryStore,
  type Planner,
  type PlannerCandidate,
  type PlannerInvocation,
} from '../../index.js';
import {
  makeTilingRequest,
  silentLogger,
} from '../__test-helpers__/fixtures.js';

const sessionId = SessionId('text-free-history');

const request = () =>
  makeTilingRequest({
    vessels: [
      {
        id: 'calendar',
        name: 'Calendar',
        description: 'Displays events',
        defaultVariant: 'month',
        variants: {
          month: {
            props: {},
            minSize: { width: 4, height: 4 },
            actions: [
              {
                name: 'showWeek',
                description: 'Show the week',
                transitionsTo: 'week',
              },
            ],
          },
          week: {
            props: {},
            minSize: { width: 4, height: 4 },
            actions: [],
          },
        },
      },
    ],
  });

const message = (id: string) =>
  ChartRequestMessage({ sessionId, id: MessageId(id), request: request() });

const textFreePlan = (): PlannerCandidate => ({
  layout: {
    type: 'tiling',
    tree: ['V', 'ID:calendar-main', 'ID:calendar-next'],
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'calendar-next', vesselId: 'calendar', variant: 'month' },
    ],
  },
  executionPlan: [{ instanceId: 'calendar-next', action: 'showWeek' }],
});

describe('text-free accepted plans', () => {
  test('persist once, replay without inference, and supply frozen structured follow-up context', async () => {
    let calls = 0;
    let followUp: PlannerInvocation | undefined;
    const planner: Planner = {
      id: 'text-free',
      supportedLayoutModes: ['tiling'],
      async invoke(invocation) {
        calls += 1;
        if (calls === 2) followUp = invocation;
        expect(
          invocation.context.calls.claim({
            plannerId: 'text-free',
            stage: 'test',
          }).ok,
        ).toBe(true);
        return ok({ kind: 'candidate' as const, candidate: textFreePlan() });
      },
    };
    const engine = createEngine({
      planner: {
        primary: {
          implementation: planner,
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      history: { store: createInMemoryStore(), planning: { maxChars: 20_000 } },
      logger: silentLogger,
    });

    const first = await engine.handle(message('first'));
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.type !== 'chart_response') {
      throw new Error('expected first chart response');
    }
    expect(first.value.response).not.toHaveProperty('userMessage');
    expect(first.value.response.executionPlan).toMatchObject([
      { instanceId: 'calendar-next', action: 'showWeek' },
    ]);

    const replay = await engine.handle(message('first'));
    expect(replay.ok).toBe(true);
    expect(calls).toBe(1);

    const second = await engine.handle(message('second'));
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
    expect(followUp?.input.history.structured).toMatchObject([
      {
        kind: 'turn',
        id: 'first',
        layout: { type: 'tiling' },
        executionPlan: [{ instanceId: 'calendar-next', action: 'showWeek' }],
      },
    ]);
    expect(followUp?.input.history.conversation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('[Accepted structural plan]'),
        }),
      ]),
    );
    expect(Object.isFrozen(followUp?.input.history.structured ?? [])).toBe(
      true,
    );

    const history = await engine.getHistory(sessionId);
    expect(history.ok).toBe(true);
    if (!history.ok) throw new Error('expected public history');
    expect(history.value[0]).toMatchObject({ kind: 'turn', id: 'first' });
    expect(history.value[0]).not.toHaveProperty('assistantMessage');
  });
});
