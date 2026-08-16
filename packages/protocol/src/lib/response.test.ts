import { describe, expect, test } from 'bun:test';

import { InstanceId } from './instance.js';
import {
  type GridLayout,
  getVisibleInstanceIds,
  isInstanceIdNode,
  isTilingSplit,
  type TilingLayout,
} from './response.js';
import { VariantName } from './variant-name.js';
import { VesselId } from './vessel-id.js';

describe('isInstanceIdNode', () => {
  test('true for a branded instance id', () => {
    expect(isInstanceIdNode(InstanceId('widget-1'))).toBe(true);
  });

  test('false for the split operators', () => {
    expect(isInstanceIdNode('H')).toBe(false);
    expect(isInstanceIdNode('V')).toBe(false);
  });

  test('false for null', () => {
    expect(isInstanceIdNode(null)).toBe(false);
  });

  test('narrows the node to InstanceId at the type level', () => {
    const tree = [InstanceId('widget-1'), 'H' as const, null];
    const leaves = tree.filter(isInstanceIdNode);
    // Compile-time: every element of `leaves` is InstanceId.
    // Runtime: only the first element survives the filter.
    expect(leaves).toHaveLength(1);
    expect(leaves[0]).toBe(InstanceId('widget-1'));
  });
});

describe('isTilingSplit', () => {
  test('true for H and V', () => {
    expect(isTilingSplit('H')).toBe(true);
    expect(isTilingSplit('V')).toBe(true);
  });

  test('false for a branded instance id', () => {
    expect(isTilingSplit(InstanceId('widget-1'))).toBe(false);
  });

  test('false for null', () => {
    expect(isTilingSplit(null)).toBe(false);
  });
});

describe('getVisibleInstanceIds', () => {
  const weatherId = InstanceId('weather-1');
  const calendarId = InstanceId('calendar-1');
  const tasksId = InstanceId('tasks-1');

  test('returns only tiling tree leaves', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['H', weatherId, 'V', null, calendarId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('deduplicates repeated tiling leaves', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: ['H', weatherId, weatherId],
      instances: [],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId]);
  });

  test('returns grid position instance IDs', () => {
    const layout: GridLayout = {
      type: 'grid',
      positions: [
        {
          instanceId: weatherId,
          position: { row: 0, column: 0 },
          size: { width: 1, height: 1 },
        },
        {
          instanceId: calendarId,
          position: { row: 0, column: 1 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([weatherId, calendarId]);
  });

  test('deduplicates repeated grid positions', () => {
    const layout: GridLayout = {
      type: 'grid',
      positions: [
        {
          instanceId: tasksId,
          position: { row: 0, column: 0 },
          size: { width: 1, height: 1 },
        },
        {
          instanceId: tasksId,
          position: { row: 1, column: 0 },
          size: { width: 1, height: 1 },
        },
      ],
    };

    expect([...getVisibleInstanceIds(layout)]).toEqual([tasksId]);
  });

  test('returns no visible Instances for a null layout', () => {
    expect([...getVisibleInstanceIds(null)]).toEqual([]);
  });

  test('does not treat tiling declarations omitted from the tree as visible', () => {
    const layout: TilingLayout = {
      type: 'tiling',
      tree: [weatherId],
      instances: [
        {
          instanceId: weatherId,
          vesselId: VesselId('weather'),
          variant: VariantName('default'),
        },
        {
          instanceId: calendarId,
          vesselId: VesselId('calendar'),
          variant: VariantName('default'),
        },
      ],
    };

    expect(getVisibleInstanceIds(layout).has(weatherId)).toBe(true);
    expect(getVisibleInstanceIds(layout).has(calendarId)).toBe(false);
  });
});

describe('isInstanceIdNode + isTilingSplit partition TilingNode', () => {
  test('every non-null node is classified by exactly one predicate', () => {
    const nodes = [
      InstanceId('widget-1'),
      InstanceId('calendar-main'),
      'H' as const,
      'V' as const,
    ];
    for (const node of nodes) {
      expect(isInstanceIdNode(node) !== isTilingSplit(node)).toBe(true);
    }
  });

  test('null is classified by neither', () => {
    expect(isInstanceIdNode(null)).toBe(false);
    expect(isTilingSplit(null)).toBe(false);
  });
});
