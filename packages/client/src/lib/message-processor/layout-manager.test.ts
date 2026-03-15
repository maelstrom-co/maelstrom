import { describe, expect, it } from 'bun:test';

import { applyLayout } from './layout-manager.js';

describe('applyLayout', () => {
  it('should create instances from tiling layout', () => {
    const layout = {
      type: 'tiling' as const,
      tree: [],
      instances: [
        {
          instanceId: 'vessel-1-abc',
          vesselId: 'vessel-1',
          variant: 'default',
        },
        {
          instanceId: 'vessel-2-def',
          vesselId: 'vessel-2',
          variant: 'compact',
        },
      ],
    };

    const instances = applyLayout(layout);

    expect(instances.size).toBe(2);
    expect(instances.has('vessel-1-abc')).toBe(true);
    expect(instances.has('vessel-2-def')).toBe(true);
    expect(instances.get('vessel-1-abc')?.vesselId).toBe('vessel-1');
    expect(instances.get('vessel-1-abc')?.variant).toBe('default');
  });

  it('should set default position and size for tiling instances', () => {
    const layout = {
      type: 'tiling' as const,
      tree: [],
      instances: [
        {
          instanceId: 'vessel-1-abc',
          vesselId: 'vessel-1',
          variant: 'default',
        },
      ],
    };

    const instances = applyLayout(layout);
    const instance = instances.get('vessel-1-abc');

    expect(instance?.position).toEqual({ column: 0, row: 0 });
    expect(instance?.size).toEqual({ width: 1, height: 1 });
  });

  it('should create instances from grid layout with positions', () => {
    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: 'grid-1',
          position: { column: 0, row: 0 },
          size: { width: 2, height: 1 },
        },
        {
          instanceId: 'grid-2',
          position: { column: 2, row: 0 },
          size: { width: 1, height: 2 },
        },
      ],
    };

    const instances = applyLayout(layout);

    expect(instances.size).toBe(2);

    const instance1 = instances.get('grid-1');
    expect(instance1?.position).toEqual({ column: 0, row: 0 });
    expect(instance1?.size).toEqual({ width: 2, height: 1 });

    const instance2 = instances.get('grid-2');
    expect(instance2?.position).toEqual({ column: 2, row: 0 });
    expect(instance2?.size).toEqual({ width: 1, height: 2 });
  });

  it('should preserve vesselId and variant from existing instances in grid layout', () => {
    const existing = new Map([
      [
        'grid-1',
        {
          instanceId: 'grid-1',
          vesselId: 'orders',
          variant: 'compact',
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    ]);

    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: 'grid-1',
          position: { column: 3, row: 2 },
          size: { width: 4, height: 3 },
        },
      ],
    };

    const instances = applyLayout(layout, existing);

    const instance = instances.get('grid-1');
    expect(instance?.vesselId).toBe('orders');
    expect(instance?.variant).toBe('compact');
    expect(instance?.position).toEqual({ column: 3, row: 2 });
    expect(instance?.size).toEqual({ width: 4, height: 3 });
  });

  it('should fall back to empty vesselId when no existing instance in grid layout', () => {
    const layout = {
      type: 'grid' as const,
      positions: [
        {
          instanceId: 'new-instance',
          position: { column: 0, row: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    const instances = applyLayout(layout, new Map());

    const instance = instances.get('new-instance');
    expect(instance?.vesselId).toBe('');
    expect(instance?.variant).toBe('default');
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
