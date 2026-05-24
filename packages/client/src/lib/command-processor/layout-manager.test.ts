import { describe, expect, it } from 'bun:test';

import { InstanceId, VariantName, VesselId } from '@maelstrom-co/protocol';

import { applyLayout } from './layout-manager.js';

describe('applyLayout', () => {
  it('should create instances from tiling layout', () => {
    const layout = {
      type: 'tiling' as const,
      tree: [],
      instances: [
        {
          instanceId: InstanceId('vessel-1-abc'),
          vesselId: 'vessel-1',
          variant: 'default',
        },
        {
          instanceId: InstanceId('vessel-2-def'),
          vesselId: 'vessel-2',
          variant: 'compact',
        },
      ],
    };

    const instances = applyLayout(layout);

    expect(instances.size).toBe(2);
    expect(instances.has(InstanceId('vessel-1-abc'))).toBe(true);
    expect(instances.has(InstanceId('vessel-2-def'))).toBe(true);
    expect(instances.get(InstanceId('vessel-1-abc'))?.vesselId).toBe(
      VesselId('vessel-1'),
    );
    expect(instances.get(InstanceId('vessel-1-abc'))?.variant).toBe(
      VariantName('default'),
    );
  });

  it('should set default position and size for tiling instances', () => {
    const layout = {
      type: 'tiling' as const,
      tree: [],
      instances: [
        {
          instanceId: InstanceId('vessel-1-abc'),
          vesselId: 'vessel-1',
          variant: 'default',
        },
      ],
    };

    const instances = applyLayout(layout);
    const instance = instances.get(InstanceId('vessel-1-abc'));

    expect(instance?.position).toEqual({ column: 0, row: 0 });
    expect(instance?.size).toEqual({ width: 1, height: 1 });
  });

  it('should create instances from grid layout with positions', () => {
    const existing = new Map([
      [
        InstanceId('grid-1'),
        {
          instanceId: InstanceId('grid-1'),
          vesselId: VesselId('orders'),
          variant: VariantName('default'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
      [
        InstanceId('grid-2'),
        {
          instanceId: InstanceId('grid-2'),
          vesselId: VesselId('inventory'),
          variant: VariantName('default'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    ]);

    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: InstanceId('grid-1'),
          position: { column: 0, row: 0 },
          size: { width: 2, height: 1 },
        },
        {
          instanceId: InstanceId('grid-2'),
          position: { column: 2, row: 0 },
          size: { width: 1, height: 2 },
        },
      ],
    };

    const instances = applyLayout(layout, existing);

    expect(instances.size).toBe(2);

    const instance1 = instances.get(InstanceId('grid-1'));
    expect(instance1?.position).toEqual({ column: 0, row: 0 });
    expect(instance1?.size).toEqual({ width: 2, height: 1 });

    const instance2 = instances.get(InstanceId('grid-2'));
    expect(instance2?.position).toEqual({ column: 2, row: 0 });
    expect(instance2?.size).toEqual({ width: 1, height: 2 });
  });

  it('should preserve vesselId and variant from existing instances in grid layout', () => {
    const existing = new Map([
      [
        InstanceId('grid-1'),
        {
          instanceId: InstanceId('grid-1'),
          vesselId: VesselId('orders'),
          variant: VariantName('compact'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    ]);

    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: InstanceId('grid-1'),
          position: { column: 3, row: 2 },
          size: { width: 4, height: 3 },
        },
      ],
    };

    const instances = applyLayout(layout, existing);

    const instance = instances.get(InstanceId('grid-1'));
    expect(instance?.vesselId).toBe(VesselId('orders'));
    expect(instance?.variant).toBe(VariantName('compact'));
    expect(instance?.position).toEqual({ column: 3, row: 2 });
    expect(instance?.size).toEqual({ width: 4, height: 3 });
  });

  it('drops grid positions for instances not in existingInstances', () => {
    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: InstanceId('unknown-instance'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    const instances = applyLayout(layout, new Map());

    expect(instances.has(InstanceId('unknown-instance'))).toBe(false);
    expect(instances.size).toBe(0);
  });

  it('drops all grid positions when existingInstances is undefined', () => {
    // Pin the optional-chained `existingInstances?.get(...)` path: passing
    // `undefined` (as `applyLayout` allows) is structurally distinct from
    // `new Map()`, but both should drop every position because no anchor
    // exists. Without this test, a regression that switched the optional
    // chain to a non-null assertion would only surface in production.
    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: InstanceId('a'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
        {
          instanceId: InstanceId('b'),
          position: { column: 1, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    const instances = applyLayout(layout);

    expect(instances.size).toBe(0);
  });

  it('drops only unanchored positions and keeps anchored ones', () => {
    const existing = new Map([
      [
        InstanceId('known'),
        {
          instanceId: InstanceId('known'),
          vesselId: VesselId('orders'),
          variant: VariantName('compact'),
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    ]);

    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: InstanceId('known'),
          position: { column: 1, row: 1 },
          size: { width: 2, height: 2 },
        },
        {
          instanceId: InstanceId('phantom'),
          position: { column: 5, row: 5 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    const instances = applyLayout(layout, existing);

    expect(instances.size).toBe(1);
    expect(instances.has(InstanceId('known'))).toBe(true);
    expect(instances.has(InstanceId('phantom'))).toBe(false);
    const kept = instances.get(InstanceId('known'));
    expect(kept?.vesselId).toBe(VesselId('orders'));
    expect(kept?.variant).toBe(VariantName('compact'));
    expect(kept?.position).toEqual({ column: 1, row: 1 });
    expect(kept?.size).toEqual({ width: 2, height: 2 });
  });

  it('should return empty map for empty tiling layout', () => {
    const layout = {
      type: 'tiling' as const,
      tree: [],
      instances: [],
    };

    const instances = applyLayout(layout);

    expect(instances.size).toBe(0);
  });

  it('should return empty map for empty grid layout', () => {
    const layout = {
      type: 'grid' as const,
      positions: [],
    };

    const instances = applyLayout(layout);

    expect(instances.size).toBe(0);
  });
});
