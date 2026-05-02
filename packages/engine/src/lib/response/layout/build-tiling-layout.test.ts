import { describe, expect, test } from 'bun:test';
import {
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { buildTilingLayout } from './build-tiling-layout.js';

describe('buildTilingLayout', () => {
  test('attaches `type: "tiling"` discriminator and passes tree/instances through', () => {
    const tree = ['H' as const, InstanceId('a'), InstanceId('b')];
    const instances = [
      {
        instanceId: InstanceId('a'),
        vesselId: VesselId('vessel-a'),
        variant: VariantName('default'),
      },
      {
        instanceId: InstanceId('b'),
        vesselId: VesselId('vessel-b'),
        variant: VariantName('default'),
      },
    ];
    const result = buildTilingLayout({ tree, instances });
    expect(result.type).toBe('tiling');
    expect(result.tree).toBe(tree);
    expect(result.instances).toBe(instances);
  });

  test('accepts an empty tree and empty instances', () => {
    const result = buildTilingLayout({ tree: [], instances: [] });
    expect(result.type).toBe('tiling');
    expect(result.tree).toEqual([]);
    expect(result.instances).toEqual([]);
  });

  test('passes through `null` leaves (empty tile slots)', () => {
    const tree = [null];
    const result = buildTilingLayout({ tree, instances: [] });
    expect(result.tree).toBe(tree);
    expect(result.tree).toEqual([null]);
  });

  test('passes through trees containing both H and V split operators', () => {
    const tree = [
      'H' as const,
      'V' as const,
      InstanceId('a'),
      InstanceId('b'),
      InstanceId('c'),
    ];
    const instances = [
      {
        instanceId: InstanceId('a'),
        vesselId: VesselId('vessel-a'),
        variant: VariantName('default'),
      },
    ];
    const result = buildTilingLayout({ tree, instances });
    expect(result.tree).toBe(tree);
    expect(result.tree).toEqual([
      'H',
      'V',
      InstanceId('a'),
      InstanceId('b'),
      InstanceId('c'),
    ]);
  });

  test('accepts a non-empty tree with no instances (split-only structure)', () => {
    const tree = ['H' as const, null, null];
    const result = buildTilingLayout({ tree, instances: [] });
    expect(result.tree).toBe(tree);
    expect(result.instances).toEqual([]);
  });
});
