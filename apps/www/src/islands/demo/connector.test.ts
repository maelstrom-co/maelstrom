import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { ChartRequestMessage, TilingLayout } from '@maelstrom-co/protocol';
import {
  MessageId,
  ChartRequestMessage as makeChartRequestMessage,
  SessionId,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { ScriptedConnector } from '../shared/ScriptedConnector';
import { createDemoConnector, DEMO_STEPS } from './connector';

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

async function processWithTick(
  connector: ScriptedConnector,
): Promise<ReturnType<ScriptedConnector['process']>> {
  const promise = connector.process(makeRequest());
  await clock.tickAsync(1200);
  return promise;
}

describe('ScriptedConnector (DEMO_STEPS)', () => {
  it('returns initial layout on first request', async () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
    const response = await connector.process(makeRequest());
    expect(response.layout).toEqual(DEMO_STEPS[0].layout);
  });

  it('returns sequential steps for consecutive requests', async () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
    await connector.process(makeRequest());
    const second = await processWithTick(connector);
    expect(second.layout).toEqual(DEMO_STEPS[1].layout);
    expect(second.rationale).toBe(DEMO_STEPS[1].rationale);
  });

  it('delays non-initial responses by the simulated engine latency', async () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
    await connector.process(makeRequest()); // initial request resolves immediately
    let resolved = false;
    const pending = connector.process(makeRequest()).then(() => {
      resolved = true;
    });
    await clock.tickAsync(1199);
    expect(resolved).toBe(false);
    await clock.tickAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });

  it('clamps to last step when requests exceed steps', async () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
    await connector.process(makeRequest());
    for (let i = 1; i < DEMO_STEPS.length + 2; i++) {
      await processWithTick(connector);
    }
    const response = await processWithTick(connector);
    expect(response.layout).toEqual(DEMO_STEPS[DEMO_STEPS.length - 1].layout);
  });

  it('resets request count', async () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
    await connector.process(makeRequest());
    await processWithTick(connector);
    connector.reset();
    const response = await connector.process(makeRequest());
    expect(response.layout).toEqual(DEMO_STEPS[0].layout);
  });

  it('includes execution plan from step', async () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
    await connector.process(makeRequest());
    await processWithTick(connector);
    const response = await processWithTick(connector);
    expect(response.executionPlan.length).toBeGreaterThan(0);
    expect(response.executionPlan[0].action).toBe('addTask');
  });

  it('subscribe returns unsubscribe function', () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
    const unsub = connector.subscribe(() => {});
    expect(typeof unsub).toBe('function');
  });

  it('reports correct capabilities', () => {
    const connector = new ScriptedConnector(DEMO_STEPS);
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

describe('createDemoConnector', () => {
  const asTiling = (layout: unknown) => layout as TilingLayout;
  // Instance IDs referenced as leaves in the tiling tree (drop split markers).
  const treeLeaves = (layout: TilingLayout) =>
    layout.tree
      .map(tilingLeafInstanceId)
      .filter((instanceId) => instanceId !== null);

  it('shows exactly two vessels per mobile step, with no tree/instance drift', async () => {
    const connector = createDemoConnector(true);
    // Exactly two cards (a dropped vessel would slip past a `<= 2` bound), and
    // every declared instance must appear as a tree leaf and vice versa — a
    // mismatch renders a broken/empty tile.
    const assertStep = (layout: TilingLayout) => {
      expect(layout.instances).toHaveLength(2);
      expect(new Set(treeLeaves(layout))).toEqual(
        new Set(layout.instances.map((inst) => inst.instanceId)),
      );
    };

    assertStep(asTiling((await connector.process(makeRequest())).layout));
    for (let i = 1; i < DEMO_STEPS.length; i++) {
      const pending = connector.process(makeRequest());
      await clock.tickAsync(1200);
      assertStep(asTiling((await pending).layout));
    }
  });

  it('keeps the full four-vessel overview on desktop', async () => {
    const connector = createDemoConnector(false);
    const initial = await connector.process(makeRequest());
    expect(asTiling(initial.layout).instances).toHaveLength(4);
  });
});
