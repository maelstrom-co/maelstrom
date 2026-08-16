import { describe, expect, it } from 'bun:test';
import {
  type GridLayout,
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { createTestOrchestrator } from '../../../test-utils/connector-mocks.js';
import type { Orchestrator } from '../orchestrator/orchestrator.js';
import { readStructuralSnapshot } from './ui-structural-snapshot.js';

const weatherId = InstanceId('weather-1');
const calendarId = InstanceId('calendar-1');
const tasksId = InstanceId('tasks-1');

const tilingDeclarations: TilingLayout['instances'] = [
  {
    instanceId: weatherId,
    vesselId: VesselId('weather'),
    variant: VariantName('weekly'),
  },
  {
    instanceId: calendarId,
    vesselId: VesselId('calendar'),
    variant: VariantName('month'),
  },
  {
    instanceId: tasksId,
    vesselId: VesselId('tasks'),
    variant: VariantName('default'),
  },
];

function createRetainedInstances() {
  return new Map([
    [
      weatherId,
      {
        instanceId: weatherId,
        vesselId: VesselId('weather'),
        variant: VariantName('weekly'),
        position: { column: 0, row: 0 },
        size: { width: 1, height: 1 },
      },
    ],
    [
      calendarId,
      {
        instanceId: calendarId,
        vesselId: VesselId('calendar'),
        variant: VariantName('month'),
        position: { column: 1, row: 0 },
        size: { width: 1, height: 1 },
      },
    ],
    [
      tasksId,
      {
        instanceId: tasksId,
        vesselId: VesselId('tasks'),
        variant: VariantName('default'),
        position: { column: 2, row: 0 },
        size: { width: 1, height: 1 },
      },
    ],
  ]);
}

function createTilingLayout(tree: TilingLayout['tree']): TilingLayout {
  return { type: 'tiling', tree, instances: tilingDeclarations };
}

function seedState(
  orchestrator: Orchestrator,
  layout: GridLayout | TilingLayout | null,
) {
  const instances = createRetainedInstances();
  orchestrator.commandProcessor.store.setState((state) => ({
    ...state,
    instances,
    layout,
  }));
  return instances;
}

describe('readStructuralSnapshot', () => {
  it('returns structural fields only (no vessel domain data)', () => {
    const { orchestrator } = createTestOrchestrator();
    const instanceId = InstanceId('i-1');

    try {
      orchestrator.commandProcessor.store.setState((state) => ({
        ...state,
        instances: new Map([
          [
            instanceId,
            {
              instanceId,
              vesselId: VesselId('v-1'),
              variant: VariantName('default'),
              position: { column: 0, row: 0 },
              size: { width: 1, height: 1 },
            },
          ],
        ]),
        layout: {
          type: 'tiling',
          tree: [instanceId],
          instances: [
            {
              instanceId,
              vesselId: VesselId('v-1'),
              variant: VariantName('default'),
            },
          ],
        },
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
    } finally {
      orchestrator.dispose();
    }
  });

  it('reports only tiling tree leaves and projects tiling declarations', () => {
    const { orchestrator } = createTestOrchestrator();
    const layout = createTilingLayout([weatherId]);
    const retainedInstances = seedState(orchestrator, layout);

    try {
      const snapshot = readStructuralSnapshot(orchestrator);

      expect(snapshot.instances).toEqual([tilingDeclarations[0]]);
      expect(snapshot.layout?.type).toBe('tiling');
      if (snapshot.layout?.type !== 'tiling') {
        throw new Error('expected tiling layout');
      }
      expect(snapshot.layout.instances).toEqual([tilingDeclarations[0]]);
      expect(snapshot.layout.tree).toEqual([weatherId]);
      expect(snapshot.instances).not.toContainEqual(tilingDeclarations[1]);
      expect(snapshot.instances).not.toContainEqual(tilingDeclarations[2]);
      expect(snapshot.layout.instances).not.toContainEqual(
        tilingDeclarations[1],
      );
      expect(snapshot.layout.instances).not.toContainEqual(
        tilingDeclarations[2],
      );
      expect(retainedInstances.size).toBe(3);
      expect(orchestrator.commandProcessor.store.state.instances.size).toBe(3);
      expect(orchestrator.commandProcessor.store.state.layout).toBe(layout);
      expect(layout.instances).toEqual(tilingDeclarations);
    } finally {
      orchestrator.dispose();
    }
  });

  it('reports only positioned grid Instances without changing retained state', () => {
    const { orchestrator } = createTestOrchestrator();
    const layout: GridLayout = {
      type: 'grid',
      positions: [
        {
          instanceId: weatherId,
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    };
    const retainedInstances = seedState(orchestrator, layout);

    try {
      const snapshot = readStructuralSnapshot(orchestrator);

      expect(snapshot.instances).toEqual([tilingDeclarations[0]]);
      expect(snapshot.layout).toBe(layout);
      expect(snapshot.layout?.type).toBe('grid');
      expect(
        snapshot.layout?.type === 'grid' && snapshot.layout.positions,
      ).toEqual(layout.positions);
      expect(retainedInstances.size).toBe(3);
      expect(orchestrator.commandProcessor.store.state.instances.size).toBe(3);
    } finally {
      orchestrator.dispose();
    }
  });

  it('reports no Instances when no layout has settled', () => {
    const { orchestrator } = createTestOrchestrator();
    const retainedInstances = seedState(orchestrator, null);

    try {
      const snapshot = readStructuralSnapshot(orchestrator);

      expect(snapshot.instances).toEqual([]);
      expect(snapshot.layout).toBeNull();
      expect(retainedInstances.size).toBe(3);
      expect(orchestrator.commandProcessor.store.state.instances.size).toBe(3);
    } finally {
      orchestrator.dispose();
    }
  });

  it('includes a retained tiling Instance after it becomes visible', () => {
    const { orchestrator } = createTestOrchestrator();
    const retainedInstances = seedState(
      orchestrator,
      createTilingLayout([weatherId]),
    );
    const weatherInstance = retainedInstances.get(weatherId);
    const calendarInstance = retainedInstances.get(calendarId);

    try {
      expect(readStructuralSnapshot(orchestrator).instances).toEqual([
        tilingDeclarations[0],
      ]);

      orchestrator.commandProcessor.store.setState((state) => ({
        ...state,
        layout: createTilingLayout(['H', weatherId, calendarId]),
      }));

      const snapshot = readStructuralSnapshot(orchestrator);
      expect(snapshot.instances).toEqual([
        tilingDeclarations[0],
        tilingDeclarations[1],
      ]);
      if (snapshot.layout?.type !== 'tiling') {
        throw new Error('expected tiling layout');
      }
      expect(snapshot.layout.instances).toEqual([
        tilingDeclarations[0],
        tilingDeclarations[1],
      ]);
      expect(
        orchestrator.commandProcessor.store.state.instances.get(weatherId),
      ).toBe(weatherInstance);
      expect(
        orchestrator.commandProcessor.store.state.instances.get(calendarId),
      ).toBe(calendarInstance);
      expect(orchestrator.commandProcessor.store.state.instances.size).toBe(3);
    } finally {
      orchestrator.dispose();
    }
  });

  it('is exposed via Orchestrator.getStructuralSnapshot()', () => {
    const { orchestrator } = createTestOrchestrator();

    try {
      expect(orchestrator.getStructuralSnapshot()).toEqual(
        readStructuralSnapshot(orchestrator),
      );
    } finally {
      orchestrator.dispose();
    }
  });
});
