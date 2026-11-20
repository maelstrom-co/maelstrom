import { describe, expect, test } from 'bun:test';

import {
  type ChartRequest,
  type GridLayout,
  InstanceId,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import {
  makeGridRequest,
  makeTilingRequest,
} from '../__test-helpers__/fixtures.js';
import { vesselIdsOnScreen } from './screen-change-on-screen.js';

function withInstances(
  chart: ChartRequest,
  ids: readonly [instanceId: string, vesselId: string][],
): ChartRequest {
  return {
    ...chart,
    instances: ids.map(([instanceId, vesselId]) => ({
      ...chart.instances[0],
      instanceId: InstanceId(instanceId),
      vesselId: VesselId(vesselId),
    })) as ChartRequest['instances'],
  };
}

function gridLayout(...ids: string[]): GridLayout {
  return {
    type: 'grid',
    positions: ids.map((id, index) => ({
      instanceId: InstanceId(id),
      position: { row: 0, column: index },
      size: { width: 1, height: 1 },
    })),
  };
}

describe('vesselIdsOnScreen', () => {
  test('lists the Vessel ids of a grid layout in layout order through the Chart Instances', () => {
    const chart = withInstances(makeGridRequest(), [
      ['cal', 'calendar'],
      ['ord', 'orders'],
    ]);

    expect<readonly string[]>(
      vesselIdsOnScreen(gridLayout('ord', 'cal'), chart),
    ).toEqual(['orders', 'calendar']);
  });

  test('lists only the tiling tree leaves, leaving hidden Instances out', () => {
    const chart = withInstances(makeTilingRequest(), [
      ['cal', 'calendar'],
      ['ord', 'orders'],
    ]);
    const layout: TilingLayout = {
      type: 'tiling',
      tree: [tilingLeafToken(InstanceId('ord'))],
      instances: [
        {
          instanceId: InstanceId('cal'),
          vesselId: VesselId('calendar'),
          variant: VariantName('month'),
        },
        {
          instanceId: InstanceId('ord'),
          vesselId: VesselId('orders'),
          variant: VariantName('detail'),
        },
      ],
    };

    expect<readonly string[]>(vesselIdsOnScreen(layout, chart)).toEqual([
      'orders',
    ]);
  });

  test('resolves an Instance declared only in the layout', () => {
    const chart = withInstances(makeTilingRequest(), []);
    const layout: TilingLayout = {
      type: 'tiling',
      tree: [tilingLeafToken(InstanceId('new-cart'))],
      instances: [
        {
          instanceId: InstanceId('new-cart'),
          vesselId: VesselId('cart'),
          variant: VariantName('full'),
        },
      ],
    };

    expect<readonly string[]>(vesselIdsOnScreen(layout, chart)).toEqual([
      'cart',
    ]);
  });

  test('lists a Vessel once when several visible Instances implement it, and skips unknown Instances', () => {
    const chart = withInstances(makeGridRequest(), [
      ['cal-a', 'calendar'],
      ['ord', 'orders'],
      ['cal-b', 'calendar'],
    ]);

    expect<readonly string[]>(
      vesselIdsOnScreen(gridLayout('cal-a', 'unknown', 'ord', 'cal-b'), chart),
    ).toEqual(['calendar', 'orders']);
  });
});
