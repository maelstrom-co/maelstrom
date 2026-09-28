import { describe, expect, test } from 'bun:test';

import type { TilingNode } from '@maelstrom-co/protocol';

import { checkArrangement } from './predicates.js';
import { scenarios, selectScenarios } from './scenarios.js';

describe('scenarios', () => {
  test('ids are unique', () => {
    const ids = scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every recorded tree satisfies its own arrangement rules', () => {
    const failures = scenarios.flatMap((scenario) => {
      const rules = scenario.expected.arrangement;
      if (!rules) return [];
      const current =
        scenario.request.layout.type === 'tiling'
          ? scenario.request.layout.tree
          : [];
      const tree = (scenario.expected.tree ?? current) as TilingNode[];
      return checkArrangement(rules, {
        request: scenario.request,
        tree,
      }).failures.map((failure) => `${scenario.id}: ${failure}`);
    });
    expect(failures).toEqual([]);
  });

  test('every scenario with rules is tagged, and rules only appear on planned ones', () => {
    for (const scenario of scenarios)
      if (scenario.expected.arrangement) {
        expect(scenario.spatial).toBeBoolean();
        expect(scenario.expected.status).toBe('planned');
      }
  });

  test('development has enough explicit arrangements and non-spatial controls', () => {
    const development = selectScenarios('development');
    const arranged = development.filter(
      (scenario) => scenario.spatial === true && scenario.expected.arrangement,
    );
    const controls = development.filter(
      (scenario) => scenario.spatial === false,
    );
    expect(arranged.length).toBeGreaterThanOrEqual(10);
    expect(controls.length).toBeGreaterThanOrEqual(6);
    const holdout = selectScenarios('holdout');
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-arr-')),
    ).toHaveLength(4);
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-ctl-')),
    ).toHaveLength(3);
    for (const id of ['swap', 'big-right', 'top-and-pair', 'bottom-strip'])
      expect(
        development.find((scenario) => scenario.id === id)?.expected.status,
      ).toBe('planned');
  });
});
