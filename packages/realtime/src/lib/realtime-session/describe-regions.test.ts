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

  it('gives every column of a four-way split its own name', () => {
    const regions = describeRegions(
      tiling(['V:1,1,1,1', leaf('a'), leaf('b'), leaf('c'), leaf('d')]),
      chart,
    );
    expect(Object.fromEntries(regions)).toEqual({
      a: 'on the left',
      b: 'on the inner left',
      c: 'on the inner right',
      d: 'on the right',
    });
  });

  it('gives every row of a four-row grid its own name', () => {
    const layout: GridLayout = {
      type: 'grid',
      positions: [0, 2, 4, 6].map((row, index) =>
        position(`row-${index}`, { row, column: 0 }, { width: 12, height: 2 }),
      ),
    };
    expect(Object.fromEntries(describeRegions(layout, chart))).toEqual({
      'row-0': 'at the top',
      'row-1': 'at the inner top',
      'row-2': 'at the inner bottom',
      'row-3': 'at the bottom',
    });
  });

  it('keeps the four corners of a two-by-two grid distinct', () => {
    const layout: GridLayout = {
      type: 'grid',
      positions: [
        position('a', { row: 0, column: 0 }, { width: 6, height: 4 }),
        position('b', { row: 0, column: 6 }, { width: 6, height: 4 }),
        position('c', { row: 4, column: 0 }, { width: 6, height: 4 }),
        position('d', { row: 4, column: 6 }, { width: 6, height: 4 }),
      ],
    };
    expect(Object.fromEntries(describeRegions(layout, chart))).toEqual({
      a: 'at the top left',
      b: 'at the top right',
      c: 'at the bottom left',
      d: 'at the bottom right',
    });
  });

  it('keeps the vertical edge for a horizontally centred panel', () => {
    const regions = describeRegions(
      tiling(['H', 'V:1,1,1', leaf('a'), leaf('b'), leaf('c'), leaf('d')]),
      chart,
    );
    expect(regions.get(InstanceId('b'))).toBe('at the top middle');
    expect(regions.get(InstanceId('d'))).toBe('at the bottom');
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
