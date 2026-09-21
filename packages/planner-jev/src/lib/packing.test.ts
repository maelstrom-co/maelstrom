import { describe, expect, test } from 'bun:test';

import {
  InstanceId,
  VariantName,
  VesselId,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { makeRequest } from './__test-helpers__/fixtures.js';
import { layoutFits } from './layout-fit.js';
import { packingChoices } from './packing.js';

const view = (
  id: string,
  vesselId: string,
  variant: string,
): VesselInstanceSnapshot => ({
  instanceId: InstanceId(id),
  vesselId: VesselId(vesselId),
  variant: VariantName(variant),
});

describe('packingChoices', () => {
  const visible = [
    view('calendar-main', 'calendar', 'month'),
    view('weather-main', 'weather', 'current'),
    view('tasks-main', 'tasks', 'list'),
    view('map-main', 'map', 'overview'),
  ];

  test('packs every instance by its minimum size when equal splits do not fit', () => {
    // 10 columns: an equal row of four gives 2.5 each, below every minimum.
    const request = makeRequest('fit them', { columns: 10, rows: 12 });
    const packed = packingChoices(request, visible, 'H');
    expect(packed.length).toBeGreaterThan(0);
    expect(
      packed.some((choice) => layoutFits(request, choice.tree, visible)),
    ).toBe(true);
    expect(packed[0]?.description).toContain('size-aware rows');
  });

  test('gives up when an instance cannot fit the Chart at all', () => {
    const request = makeRequest('fit them', { columns: 5, rows: 5 });
    expect(packingChoices(request, visible, 'H')).toEqual([]);
    expect(packingChoices(request, visible, 'V')).toEqual([]);
  });

  test('offers nothing for an empty visible set', () => {
    expect(packingChoices(makeRequest('x'), [], 'V')).toEqual([]);
  });
});
