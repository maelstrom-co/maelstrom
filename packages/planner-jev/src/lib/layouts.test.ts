import { describe, expect, test } from 'bun:test';

import {
  InstanceId,
  type TilingNode,
  VariantName,
  VesselId,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { makeRequest, vessels } from './__test-helpers__/fixtures.js';
import { withMinSizes } from './__test-helpers__/layout-fixtures.js';
import { layoutFits } from './layout-fit.js';
import { layoutChoices } from './layouts.js';

const view = (
  id: string,
  vesselId: string,
  variant: string,
): VesselInstanceSnapshot => ({
  instanceId: InstanceId(id),
  vesselId: VesselId(vesselId),
  variant: VariantName(variant),
});
const calendar = view('calendar-main', 'calendar', 'month');
const weather = view('weather-main', 'weather', 'current');
const tasks = view('tasks-main', 'tasks', 'list');
const ids = (choices: ReturnType<typeof layoutChoices>) =>
  choices.map((c) => c.id);

describe('layoutChoices', () => {
  test('offers preserve, balanced, focus and packed candidates for the current board', () => {
    const request = makeRequest('arrange');
    const choices = layoutChoices(request, [calendar, weather, tasks]);
    expect(ids(choices)).toContain('preserve');
    expect(ids(choices)).toContain('row');
    expect(ids(choices)).toContain('column');
    expect(ids(choices)).toContain('rows_2');
    expect(ids(choices)).toContain('focus/V/calendar-main');
    for (const choice of choices)
      expect(layoutFits(request, choice.tree, [calendar, weather, tasks])).toBe(
        true,
      );
    expect(
      choices.find((c) => c.id === 'focus/V/calendar-main')
        ?.tree as TilingNode[],
    ).toEqual([
      'V:2,1',
      'ID:calendar-main',
      'H',
      'ID:weather-main',
      'ID:tasks-main',
    ] as TilingNode[]);
  });

  test('offers a full-Chart alternative when preserving one instance would keep empty space', () => {
    const request = makeRequest('make weather fill the chart', {
      tree: ['V', 'ID:weather-main', null],
    });
    const choices = layoutChoices(request, [weather]);
    expect(ids(choices)).toEqual(['preserve', 'single']);
  });

  test('offers only layouts that satisfy every minimum size', () => {
    const catalog = withMinSizes(vessels, () => ({ width: 6, height: 4 }));
    const request = makeRequest('arrange both', {
      vessels: catalog,
      columns: 10,
      rows: 10,
      tree: ['H', 'ID:weather-main', 'ID:tasks-main'],
    });
    const choices = layoutChoices(request, [weather, tasks]);
    expect(ids(choices)).not.toContain('row');
    expect(ids(choices)).toContain('column');
  });

  test('offers nothing when no complete layout fits', () => {
    const catalog = withMinSizes(vessels, () => ({ width: 8, height: 8 }));
    const request = makeRequest('arrange both', {
      vessels: catalog,
      columns: 10,
      rows: 10,
    });
    expect(layoutChoices(request, [weather, tasks])).toEqual([]);
  });

  test('an impossible row count is simply not offered', () => {
    const request = makeRequest('four rows');
    expect(
      ids(layoutChoices(request, [calendar, weather, tasks])),
    ).not.toContain('rows_4');
  });
});

describe('layoutChoices placements mode', () => {
  test('collapses candidates whose Instances land on the same rectangles, keeping the first', () => {
    const request = makeRequest('arrange');
    const visible = [calendar, weather, tasks];
    const tokenChoices = layoutChoices(request, visible);
    // The current board is already one equal-width row, so preserve and row
    // resolve to the exact same rectangles.
    expect(ids(tokenChoices)).toContain('preserve');
    expect(ids(tokenChoices)).toContain('row');

    const placementChoices = layoutChoices(request, visible, {
      describe: 'placements',
    });
    expect(ids(placementChoices)).toContain('preserve');
    expect(ids(placementChoices)).not.toContain('row');
    expect(ids(placementChoices).length).toBeLessThan(ids(tokenChoices).length);
  });

  test('describes every visible Instance and its position in plain words', () => {
    const request = makeRequest('arrange');
    const visible = [calendar, weather, tasks];
    const choices = layoutChoices(request, visible, { describe: 'placements' });
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices)
      for (const instance of visible)
        expect(choice.description).toContain(instance.instanceId);
  });

  test('uses side-by-side and stacked wording, never row/column direction jargon', () => {
    // A preserve tree shaped like the focus candidate, so it collides with
    // that candidate instead of with row or column.
    const request = makeRequest('arrange', {
      tree: [
        'V:2,1',
        'ID:calendar-main',
        'H',
        'ID:weather-main',
        'ID:tasks-main',
      ],
    });
    const choices = layoutChoices(request, [calendar, weather, tasks], {
      describe: 'placements',
    });
    const row = choices.find((c) => c.id === 'row');
    expect(row?.description.toLowerCase()).toContain('side by side');
    const column = choices.find((c) => c.id === 'column');
    expect(column?.description.toLowerCase()).toContain('stacked');
    for (const choice of choices) {
      expect(choice.description.toLowerCase()).not.toContain('left-right');
      expect(choice.description.toLowerCase()).not.toContain('top-bottom');
    }
  });

  test('names a mixed group with a position and full-width qualifier', () => {
    const request = makeRequest('arrange');
    const choices = layoutChoices(request, [calendar, weather, tasks], {
      describe: 'placements',
    });
    const rows2 = choices.find((c) => c.id === 'rows_2');
    expect(rows2).toBeDefined();
    expect(rows2?.description).toContain('full width');
  });

  test('does not change the default describe mode output', () => {
    const request = makeRequest('arrange');
    const visible = [calendar, weather, tasks];
    expect(layoutChoices(request, visible, { describe: 'tokens' })).toEqual(
      layoutChoices(request, visible),
    );
  });
});
