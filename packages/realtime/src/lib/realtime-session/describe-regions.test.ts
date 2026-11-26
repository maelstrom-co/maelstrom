import { describe, expect, it } from 'bun:test';

import type {
  GridLayout,
  TilingLayout,
  TilingNode,
} from '@maelstrom-co/protocol';
import {
  InstanceId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { describeRegions } from './describe-regions.js';

const chart = { columns: 12, rows: 8 };

describe('describeRegions', () => {
  it('reads a V split as left and right, using the Tasklane starting tree', () => {
    const regions = describeRegions(
      tiling(['V:2,3', leaf('feedback'), leaf('tasks')]),
      chart,
    );
    expect(regions.get(InstanceId('feedback'))).toBe('on the left');
    expect(regions.get(InstanceId('tasks'))).toBe('on the right');
  });

  it('reads an H split as top and bottom, using the narrow Tasklane tree', () => {
    const regions = describeRegions(
      tiling(['H', leaf('feedback'), leaf('tasks')]),
      chart,
    );
    expect(regions.get(InstanceId('feedback'))).toBe('at the top');
    expect(regions.get(InstanceId('tasks'))).toBe('at the bottom');
  });

  it('combines nested splits into corner regions', () => {
    const regions = describeRegions(
      tiling(['V', 'H', leaf('a'), leaf('b'), leaf('c')]),
      chart,
    );
    expect(Object.fromEntries(regions)).toEqual({
      a: 'at the top left',
      b: 'at the bottom left',
      c: 'on the right',
    });
  });

  it('names the middle child of a three-way split', () => {
    const regions = describeRegions(
      tiling(['V:1,1,1', leaf('a'), leaf('b'), leaf('c')]),
      chart,
    );
    expect(Object.fromEntries(regions)).toEqual({
      a: 'on the left',
      b: 'in the middle',
      c: 'on the right',
    });
  });

  it('skips null leaves while keeping the space they occupy', () => {
    const regions = describeRegions(
      tiling(['V', null, 'H', leaf('a'), null]),
      chart,
    );
    expect(Object.fromEntries(regions)).toEqual({ a: 'at the top right' });
  });

  it('describes a single leaf as filling the screen and ignores trailing tokens', () => {
    const regions = describeRegions(tiling([leaf('a'), leaf('b')]), chart);
    expect(Object.fromEntries(regions)).toEqual({ a: 'filling the screen' });
  });

  it('describes grid positions against the Chart dimensions', () => {
    const layout: GridLayout = {
      type: 'grid',
      positions: [
        position('a', { row: 0, column: 0 }, { width: 6, height: 8 }),
        position('b', { row: 0, column: 6 }, { width: 6, height: 4 }),
        position('c', { row: 4, column: 6 }, { width: 6, height: 4 }),
      ],
    };
    expect(Object.fromEntries(describeRegions(layout, chart))).toEqual({
      a: 'on the left',
      b: 'at the top right',
      c: 'at the bottom right',
    });
  });

  it('returns no regions before a layout applies', () => {
    expect(describeRegions(null, chart).size).toBe(0);
  });
});

function leaf(id: string): TilingNode {
  return tilingLeafToken(InstanceId(id));
}

function tiling(tree: TilingNode[]): TilingLayout {
  return {
    type: 'tiling',
    tree,
    instances: tree.flatMap((node) =>
      node !== null && node.startsWith('ID:')
        ? [
            {
              instanceId: InstanceId(node.slice(3)),
              vesselId: VesselId('vessel'),
              variant: VariantName('default'),
            },
          ]
        : [],
    ),
  };
}

function position(
  id: string,
  at: { row: number; column: number },
  size: { width: number; height: number },
): GridLayout['positions'][number] {
  return { instanceId: InstanceId(id), position: at, size };
}
