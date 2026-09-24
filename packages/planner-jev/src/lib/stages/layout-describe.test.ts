import { describe, expect, test } from 'bun:test';

import type { TilingNode } from '@maelstrom-co/protocol';

import { describeLayout } from './layout-describe.js';

const tree = (...tokens: (string | null)[]) => tokens as TilingNode[];

describe('describeLayout', () => {
  test('a single Instance fills the Chart', () => {
    expect(describeLayout(tree('ID:calendar'))).toBe(
      'calendar fills the chart',
    );
  });

  test('a nested part reads as stacked on its side', () => {
    expect(
      describeLayout(tree('V', 'ID:calendar', 'H', 'ID:tasks', 'ID:map')),
    ).toBe('calendar on the left; tasks and map stacked on the right');
  });

  test('three stacked parts, one of them side by side', () => {
    expect(
      describeLayout(
        tree(
          'H:1,1,1',
          'ID:weather',
          'V:1,1,1',
          'ID:calendar',
          'ID:tasks',
          'ID:map',
          null,
        ),
      ),
    ).toBe(
      'weather at the top; calendar, tasks and map side by side in the middle; nothing at the bottom',
    );
  });

  test('unequal weights state each share', () => {
    expect(
      describeLayout(
        tree(
          'V:1,4',
          'H',
          'ID:calendar',
          'ID:tasks',
          'H:1,1,2',
          'ID:map',
          'ID:weather',
          'ID:journal',
        ),
      ),
    ).toBe(
      'calendar and tasks stacked on the left (1/5 of the width); map (1/4 of the height), weather (1/4 of the height) and journal (1/2 of the height) stacked on the right (4/5 of the width)',
    );
  });

  test('four parts side by side name the inner ones by their order', () => {
    expect(
      describeLayout(tree('V:1,1,1,1', 'ID:a', 'ID:b', 'ID:c', 'ID:d')),
    ).toBe(
      'a on the left; b second from the left; c third from the left; d on the right',
    );
  });

  test('a split inside a nested part is wrapped', () => {
    expect(
      describeLayout(tree('V', 'ID:a', 'H', 'ID:b', 'V', 'ID:c', 'ID:d')),
    ).toBe('a on the left; b and (c and d side by side) stacked on the right');
  });

  test('an empty tree is an empty chart', () => {
    expect(describeLayout([])).toBe('the chart is empty');
  });
});
