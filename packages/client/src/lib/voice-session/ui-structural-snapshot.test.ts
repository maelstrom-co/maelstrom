import { describe, expect, it, mock } from 'bun:test';
import {
  InstanceId,
  type SessionId,
  VariantName,
  VesselId,
  type MaelstromResponse,
} from '@maelstrom-co/protocol';

import type {
  ConnectorEvent,
  EngineConnector,
} from '../connection-manager/connector.types.js';
import type { Unsubscribe } from '../types.js';
import { Orchestrator } from '../orchestrator/orchestrator.js';
import { readStructuralSnapshot } from './ui-structural-snapshot.js';

// ============================================================================
// Test helpers (mirrors packages/client/src/lib/orchestrator/orchestrator.test.ts)
// ============================================================================

function createMockConnector(
  overrides: Partial<EngineConnector> = {},
): EngineConnector {
  return {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: mock((_sessionId: SessionId) => Promise.resolve()),
    disconnect: mock(() => Promise.resolve()),
    process: mock(() => Promise.resolve({} as MaelstromResponse)),
    subscribe: mock(
      (_handler: (event: ConnectorEvent) => void): Unsubscribe =>
        () => {},
    ),
    addAssistantMessage: mock(() => Promise.resolve()),
    getHistory: mock(() => Promise.resolve([])),
    ...overrides,
  };
}

function createTestOrchestrator() {
  return new Orchestrator(createMockConnector(), {});
}

describe('readStructuralSnapshot', () => {
  it('returns structural fields only (no vessel domain data)', () => {
    const orchestrator = createTestOrchestrator();

    orchestrator.commandProcessor.store.setState((s) => ({
      ...s,
      instances: new Map([
        [
          InstanceId('i-1'),
          {
            instanceId: InstanceId('i-1'),
            vesselId: VesselId('v-1'),
            variant: VariantName('default'),
            position: { column: 0, row: 0 },
            size: { width: 1, height: 1 },
          },
        ],
      ]),
    }));

    const snap = readStructuralSnapshot(orchestrator);

    expect(snap).toHaveProperty('layoutMode');
    expect(snap).toHaveProperty('chartDimensions');
    expect(snap).toHaveProperty('layout');
    expect(Array.isArray(snap.instances)).toBe(true);
    expect(snap.instances).toHaveLength(1);
    for (const inst of snap.instances) {
      expect(Object.keys(inst).sort()).toEqual([
        'instanceId',
        'variant',
        'vesselId',
      ]);
    }

    orchestrator.dispose();
  });

  it('is exposed via Orchestrator.getStructuralSnapshot()', () => {
    const orchestrator = createTestOrchestrator();

    expect(orchestrator.getStructuralSnapshot()).toEqual(
      readStructuralSnapshot(orchestrator),
    );

    orchestrator.dispose();
  });
});
