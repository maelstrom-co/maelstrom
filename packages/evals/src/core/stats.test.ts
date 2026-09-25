import { describe, expect, test } from 'bun:test';

import { PLANNER_RATIO, percentile, ratio, STAGE_RATIO } from './stats.js';

describe('ratio', () => {
  test('prints the planner report ratio to one decimal and n/a over no turns', () => {
    expect(ratio({ count: 1, total: 3 }, PLANNER_RATIO)).toBe('1/3 (33.3%)');
    expect(ratio({ count: 2, total: 3 }, PLANNER_RATIO)).toBe('2/3 (66.7%)');
    expect(ratio({ count: 0, total: 0 }, PLANNER_RATIO)).toBe('n/a');
  });

  test('prints the stage report ratio as a whole percentage and 0/0 over no turns', () => {
    expect(ratio({ count: 1, total: 3 }, STAGE_RATIO)).toBe('1/3 (33%)');
    expect(ratio({ count: 1, total: 8 }, STAGE_RATIO)).toBe('1/8 (13%)');
    expect(ratio({ count: 0, total: 0 }, STAGE_RATIO)).toBe('0/0');
  });

  test('prints the empty text whatever the count when the total is 0', () => {
    expect(ratio({ count: 2, total: 0 }, PLANNER_RATIO)).toBe('n/a');
    expect(ratio({ count: 2, total: 0 }, STAGE_RATIO)).toBe('0/0');
  });

  test('rounds a whole percentage as the stage report always has', () => {
    for (let total = 1; total <= 200; total++)
      for (let count = 0; count <= total; count++)
        expect(ratio({ count, total }, STAGE_RATIO)).toBe(
          `${count}/${total} (${Math.round((count / total) * 100)}%)`,
        );
  });
});

describe('percentile', () => {
  test('takes the nearest rank, and nothing without samples', () => {
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(percentile([3, 1, 2], 95)).toBe(3);
    expect(percentile([], 50)).toBeUndefined();
  });
});
