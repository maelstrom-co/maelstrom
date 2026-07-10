import { describe, expect, it } from 'bun:test';
import { InstanceId, VariantName, VesselId } from '@maelstrom-co/protocol';

import { createTestOrchestrator } from '../../../test-utils/connector-mocks.js';
import { readStructuralSnapshot } from './ui-structural-snapshot.js';

describe('readStructuralSnapshot', () => {
  it('returns structural fields only (no vessel domain data)', () => {
    const { orchestrator } = createTestOrchestrator();

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
    const { orchestrator } = createTestOrchestrator();

    expect(orchestrator.getStructuralSnapshot()).toEqual(
      readStructuralSnapshot(orchestrator),
    );

    orchestrator.dispose();
  });
});
