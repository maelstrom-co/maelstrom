import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  ActionName,
  InstanceId,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { createMockResponse } from '../../../test-utils/mocks.js';
import type {
  ConnectorEvent,
  EngineConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';

// ============================================================================
// Test helpers (mirrors orchestrator.test.ts's connector-mock preamble)
// ============================================================================

function createMockConnector(
  overrides: Partial<EngineConnector> = {},
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: mock((_sessionId: SessionId) => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    process: mock(() =>
      Promise.resolve(
        createMockResponse(MessageId('req-1'), 'instance-1', 'show'),
      ),
    ),
    subscribe: mock(
      (_handler: (event: ConnectorEvent) => void): Unsubscribe => () => {},
    ),
    addAssistantMessage: mock(() => Promise.resolve()),
    getHistory: mock(() => Promise.resolve([])),
    ...overrides,
  };
}

function createTestOrchestrator(connector?: EngineConnector) {
  const conn = connector ?? createMockConnector();
  const orchestrator = new Orchestrator(conn, {});
  return { connector: conn, orchestrator };
}

// ============================================================================
// Tests
// ============================================================================

describe('Orchestrator.onSettled', () => {
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    clock.uninstall();
  });

  it('fires after layout+actions have applied, not before', async () => {
    const { orchestrator } = createTestOrchestrator();
    const order: string[] = [];
    let snapshotAtSettle: unknown = null;

    orchestrator.onSettled(() => {
      order.push('settled');
      // The layout applied by set_layout must already be visible in the
      // store by the time settled fires (set_layout is processed before
      // the queue drains to idle within the same atomic dispatch batch).
      snapshotAtSettle = orchestrator.commandProcessor.store.state.instances.get(
        InstanceId('instance-1'),
      );
    });

    await orchestrator.processIntent('show labs');
    order.push('processIntent-returned');

    // Settle must have happened by the time the queue drained (dispatch is
    // fire-and-forget from processIntent's perspective — the execute_actions
    // command can still be in flight, e.g. waiting on runner readiness, when
    // processIntent resolves; waitForIdle is the deterministic join point).
    await orchestrator.commandProcessor.waitForIdle();

    expect(order).toContain('settled');
    // The snapshot read inside the callback must reflect the applied
    // layout: set_layout is processed before the queue's idle transition
    // within the same atomic dispatch batch.
    expect(snapshotAtSettle).toBeDefined();
    expect(
      (snapshotAtSettle as { variant: string } | undefined)?.variant,
    ).toBe('default');
  });

  it('fires on direct manipulation (executeActions called outside processIntent)', async () => {
    // Investigation finding: direct manipulation (user clicks / variant
    // changes, wired via React's executeAction -> commandProcessor.executeActions())
    // traverses the SAME CommandProcessor queue as engine-dispatched responses
    // (see use-vessel-core.ts's executeAction callback). There is no
    // store-bypassing write path for direct manipulation, so the queue-idle
    // transition alone grounds both D6 settle sources.
    const { orchestrator } = createTestOrchestrator();
    let settledCount = 0;
    orchestrator.onSettled(() => {
      settledCount += 1;
    });

    orchestrator.commandProcessor.executeActions([
      { instanceId: InstanceId('instance-1'), action: ActionName('select') },
    ]);

    await orchestrator.commandProcessor.waitForIdle();

    expect(settledCount).toBeGreaterThanOrEqual(1);
  });

  it('returns a working Unsubscribe', async () => {
    const { orchestrator } = createTestOrchestrator();
    let calls = 0;
    const unsubscribe = orchestrator.onSettled(() => {
      calls += 1;
    });

    unsubscribe();

    await orchestrator.processIntent('show labs');
    await orchestrator.commandProcessor.waitForIdle();

    expect(calls).toBe(0);
  });
});
