import { describe, expect, test } from 'bun:test';

import {
  InstanceId,
  type TilingNode,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { makeRequest } from './__test-helpers__/fixtures.js';
import { layoutFits, splitTree, treeRects } from './layout-fit.js';

const view = (id: string, vesselId: string, variant: string) => ({
  instanceId: InstanceId(id),
  vesselId: VesselId(vesselId),
  variant: VariantName(variant),
});
const leaf = (id: string) => [tilingLeafToken(InstanceId(id))];
const calendar = view('calendar-main', 'calendar', 'month');
const weather = view('weather-main', 'weather', 'current');

describe('splitTree', () => {
  test('joins children under one weighted token', () => {
    expect(
      splitTree('V', [leaf('a'), leaf('b')], [2, 1]) as TilingNode[],
    ).toEqual(['V:2,1', 'ID:a', 'ID:b'] as TilingNode[]);
  });
  test('returns a single child unchanged and nothing for no children', () => {
    expect(splitTree('H', [leaf('a')])).toEqual(leaf('a'));
    expect(splitTree('H', [])).toEqual([]);
  });
  test('refuses more children than a split holds', () => {
    expect(
      splitTree(
        'V',
        Array.from({ length: 13 }, (_, i) => leaf(`i${i}`)),
      ),
    ).toEqual([]);
  });
});

describe('layoutFits', () => {
  const request = makeRequest('arrange', { columns: 10, rows: 8 });

  test('accepts a tree that gives every visible instance its minimum size', () => {
    expect(
      layoutFits(
        request,
        ['H:1,1', 'ID:calendar-main', 'ID:weather-main'] as TilingNode[],
        [calendar, weather],
      ),
    ).toBe(true);
  });

  test('rejects a split that leaves an instance below its minimum size', () => {
    // A row of two halves gives weather 5 columns; it needs 6.
    expect(
      layoutFits(
        request,
        ['V:1,1', 'ID:calendar-main', 'ID:weather-main'] as TilingNode[],
        [calendar, weather],
      ),
    ).toBe(false);
  });

  test('rejects trees that omit, repeat or add instances', () => {
    expect(
      layoutFits(request, ['ID:calendar-main'] as TilingNode[], [
        calendar,
        weather,
      ]),
    ).toBe(false);
    expect(
      layoutFits(
        request,
        ['H', 'ID:calendar-main', 'ID:calendar-main'] as TilingNode[],
        [calendar],
      ),
    ).toBe(false);
    expect(
      layoutFits(
        request,
        ['H', 'ID:calendar-main', 'ID:tasks-main'] as TilingNode[],
        [calendar],
      ),
    ).toBe(false);
  });

  test('an empty tree fits only an empty visible set', () => {
    expect(layoutFits(request, [], [])).toBe(true);
    expect(layoutFits(request, [], [calendar])).toBe(false);
  });

  test('null leaves reserve space without placing anything', () => {
    expect(
      layoutFits(request, ['V', 'ID:weather-main', null] as TilingNode[], [
        view('weather-main', 'weather', 'current'),
      ]),
    ).toBe(false);
    const wide = makeRequest('arrange', { columns: 14, rows: 8 });
    expect(
      layoutFits(wide, ['V', 'ID:weather-main', null] as TilingNode[], [
        weather,
      ]),
    ).toBe(true);
  });
});

describe('treeRects', () => {
  const request = makeRequest('arrange', { columns: 12, rows: 6 });

  test('places each leaf in chart units, splits left to right and top to bottom', () => {
    expect(
      treeRects(request, [
        'V:2,1',
        'ID:calendar-main',
        'H',
        'ID:weather-main',
        'ID:tasks-main',
      ] as TilingNode[]),
    ).toEqual([
      {
        instanceId: InstanceId('calendar-main'),
        x: 0,
        y: 0,
        width: 8,
        height: 6,
      },
      {
        instanceId: InstanceId('weather-main'),
        x: 8,
        y: 0,
        width: 4,
        height: 3,
      },
      { instanceId: InstanceId('tasks-main'), x: 8, y: 3, width: 4, height: 3 },
    ]);
  });

  test('null leaves take space without a rect', () => {
    expect(
      treeRects(request, ['H:1,2', null, 'ID:weather-main'] as TilingNode[]),
    ).toEqual([
      {
        instanceId: InstanceId('weather-main'),
        x: 0,
        y: 2,
        width: 12,
        height: 4,
      },
    ]);
  });

  test('rejects malformed trees', () => {
    expect(treeRects(request, ['V', 'ID:calendar-main'] as TilingNode[])).toBe(
      undefined,
    );
    expect(
      treeRects(request, [
        'ID:calendar-main',
        'ID:weather-main',
      ] as TilingNode[]),
    ).toBe(undefined);
    expect(treeRects(request, ['nonsense'] as unknown as TilingNode[])).toBe(
      undefined,
    );
  });
});
