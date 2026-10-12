import type { Engine } from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  type EngineMessage,
  encodeEnvelope,
  MessageId,
  ok,
  SessionId,
  type UpdateReason,
} from '@maelstrom-co/protocol';
import { describe, expect, it, vi } from 'vitest';
import { type PlannerIntent, plannerIntentOf } from './agent-planner';
import { EngineFacade } from './engine-facade';

function chartRequest(id: string, reason: UpdateReason): string {
  return encodeEnvelope(
    ChartRequestMessage({
      id: MessageId(id),
      sessionId: SessionId('s-1'),
      request: {
        type: 'chart_request',
        context: {
          updateReasons: [reason],
          chartDimensions: { rows: 8, columns: 12 },
          layoutMode: 'grid',
        },
        instances: [],
        vessels: [],
        layout: { type: 'grid', positions: [] },
      },
    }),
  );
}

const resize: UpdateReason = {
  type: 'chart_resize',
  previous: { rows: 6, columns: 10 },
  current: { rows: 8, columns: 12 },
};

/** A Planner engine that records the intent it saw and how many calls overlap. */
function recordingPlanner() {
  const seen: (PlannerIntent | undefined)[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const engine: Engine = {
    handle: async (message: EngineMessage) => {
      if (message.type !== 'chart_request') throw new Error('unexpected');
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.push(plannerIntentOf({ messageId: message.id }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return ok({
        type: 'chart_response',
        sessionId: message.sessionId,
        id: message.id,
        response: {
          type: 'maelstrom_response',
          requestId: message.id,
          userMessage: 'resized',
          rationale: 'fit',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });
    },
    getHistory: async () => {
      throw new Error('the facade never reads Engine history');
    },
  };
  return {
    engine,
    seen,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

describe('EngineFacade', () => {
  it('answers a chart resize through the Planner under its own request id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const planner = recordingPlanner();
    const sent: string[] = [];
    const facade = new EngineFacade({
      planner: planner.engine,
      send: (wire) => sent.push(wire),
    });

    await facade.handle(chartRequest('req-1', resize));

    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
      type: 'engine.maelstrom.response',
      requestId: 'req-1',
    });
    expect(planner.seen[0]?.origin).toBe('chart_resize');
  });

  it('keeps at most one Planner call in flight', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const planner = recordingPlanner();
    const facade = new EngineFacade({
      planner: planner.engine,
      send: () => {},
    });

    await Promise.all([
      facade.handle(chartRequest('req-1', resize)),
      facade.handle(
        chartRequest('req-2', {
          type: 'user_intent',
          intent: 'show the cart',
        }),
      ),
    ]);

    expect(planner.seen.map((intent) => intent?.origin)).toEqual([
      'chart_resize',
      'user_intent',
    ]);
    expect(planner.maxInFlight).toBe(1);
  });

  it('fails an Agent Session turn fast without a loop key, without calling the Planner', async () => {
    const planner = recordingPlanner();
    const sent: string[] = [];
    const facade = new EngineFacade({
      planner: planner.engine,
      send: (wire) => sent.push(wire),
    });

    await facade.handle(
      JSON.stringify({
        type: 'agent.input',
        turnId: 't-1',
        input: { kind: 'user_text', text: 'show my orders' },
        chart: {
          sessionId: 's-1',
          chartDimensions: { rows: 8, columns: 12 },
          layoutMode: 'grid',
          instances: [],
          vessels: [],
          layout: { type: 'grid', positions: [] },
        },
      }),
    );

    expect(JSON.parse(sent[0] ?? '{}')).toMatchObject({
      type: 'agent.done',
      turnId: 't-1',
      ok: false,
    });
    expect(planner.seen).toHaveLength(0);
  });
});
