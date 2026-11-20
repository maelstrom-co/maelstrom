import { describe, expect, test } from 'bun:test';

import {
  describeScreenChangeResult,
  SCREEN_CHANGE_SUMMARY_MAX_CHARS,
  type ScreenChangeOutcome,
} from './screen-change-result.js';

describe('describeScreenChangeResult', () => {
  const cases: readonly [ScreenChangeOutcome, string][] = [
    ['applied', 'applied: "show order o-1"'],
    ['already_on_screen', 'applied (already on screen): "show order o-1"'],
    ['failed', 'failed: "show order o-1"'],
    ['partially_failed', 'failed (some steps did not run): "show order o-1"'],
    ['unknown', 'unknown (the screen did not confirm): "show order o-1"'],
    ['needs_clarification', 'needs clarification: "show order o-1"'],
    ['cancelled', 'cancelled: "show order o-1"'],
  ];

  for (const [outcome, summary] of cases) {
    test(`${outcome} reads ${summary}`, () => {
      expect(describeScreenChangeResult('show order o-1', outcome)).toBe(
        summary,
      );
    });
  }

  test('a long goal is shortened inside its quotes so the summary stays within 200 characters', () => {
    const goal = 'x'.repeat(500);
    for (const [outcome] of cases) {
      const summary = describeScreenChangeResult(goal, outcome);
      expect(summary.length).toBeLessThanOrEqual(
        SCREEN_CHANGE_SUMMARY_MAX_CHARS,
      );
      expect(summary.endsWith('…"')).toBe(true);
    }
    expect(SCREEN_CHANGE_SUMMARY_MAX_CHARS).toBe(200);
  });

  test('a goal that fits is kept whole', () => {
    const goal = 'y'.repeat(150);
    expect(describeScreenChangeResult(goal, 'applied')).toBe(
      `applied: "${goal}"`,
    );
  });
});
