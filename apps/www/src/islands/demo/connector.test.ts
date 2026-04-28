import { afterEach, beforeEach, describe, it, expect } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';
import { DemoConnector, DEMO_STEPS } from './connector';
import type { ChartRequestMessage } from '@maelstrom-co/protocol';
import {
  ChartRequestMessage as makeChartRequestMessage,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

let clock: FakeTimers.InstalledClock;

beforeEach(() => {
  clock = FakeTimers.install();
});

afterEach(() => {
  clock.uninstall();
});

function makeRequest(): ChartRequestMessage {
  return makeChartRequestMessage({
    sessionId: SessionId('test-session'),
    id: MessageId(crypto.randomUUID()),
    request: {
      type: 'chart_request',
      context: {
        updateReasons: [],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      instances: [],
      vessels: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    },
  });
}

async function processWithTick(connector: DemoConnector): Promise<ReturnType<DemoConnector['process']>> {
  const promise = connector.process(makeRequest());
  await clock.tickAsync(1200);
  return promise;
}

describe('DemoConnector', () => {
  it('returns initial layout on first request', async () => {
    const connector = new DemoConnector();
    const response = await connector.process(makeRequest());
    expect(response.layout).toEqual(DEMO_STEPS[0].layout);
  });

  it('returns sequential steps for consecutive requests', async () => {
    const connector = new DemoConnector();
    await connector.process(makeRequest());
    const second = await processWithTick(connector);
    expect(second.layout).toEqual(DEMO_STEPS[1].layout);
    expect(second.rationale).toBe(DEMO_STEPS[1].rationale);
  });

  it('clamps to last step when requests exceed steps', async () => {
    const connector = new DemoConnector();
    await connector.process(makeRequest());
    for (let i = 1; i < DEMO_STEPS.length + 2; i++) {
      await processWithTick(connector);
    }
    const response = await processWithTick(connector);
    expect(response.layout).toEqual(DEMO_STEPS[DEMO_STEPS.length - 1].layout);
  });

  it('resets request count', async () => {
    const connector = new DemoConnector();
    await connector.process(makeRequest());
    await processWithTick(connector);
    connector.reset();
    const response = await connector.process(makeRequest());
    expect(response.layout).toEqual(DEMO_STEPS[0].layout);
  });

  it('includes execution plan from step', async () => {
    const connector = new DemoConnector();
    await connector.process(makeRequest());
    await processWithTick(connector);
    const response = await processWithTick(connector);
    expect(response.executionPlan.length).toBeGreaterThan(0);
    expect(response.executionPlan[0].action).toBe('addTask');
  });

  it('subscribe returns unsubscribe function', () => {
    const connector = new DemoConnector();
    const unsub = connector.subscribe(() => {});
    expect(typeof unsub).toBe('function');
  });

  it('reports correct capabilities', () => {
    const connector = new DemoConnector();
    expect(connector.capabilities).toEqual({
      voice: false,
      streaming: false,
      stateful: true,
    });
  });
});

describe('DEMO_STEPS', () => {
  it('has at least 3 steps', () => {
    expect(DEMO_STEPS.length).toBeGreaterThanOrEqual(3);
  });

  it('each step has required fields', () => {
    for (const step of DEMO_STEPS) {
      expect(step).toHaveProperty('rationale');
      expect(step).toHaveProperty('executionPlan');
      expect(step).toHaveProperty('layout');
      expect(step.layout).toHaveProperty('type', 'tiling');
    }
  });

  it('all steps have prompts except initial', () => {
    expect(DEMO_STEPS[0].prompt).toBeUndefined();
    for (let i = 1; i < DEMO_STEPS.length; i++) {
      expect(DEMO_STEPS[i].prompt).toBeDefined();
    }
  });
});
