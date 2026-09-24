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

  test.each([
    [
      'half-of-left-column-nested',
      [
        'H:5,2',
        'V:1,2,1',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'full-height-column-keep-row',
      [
        'V:3,2,2,4',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:journal-main',
        'H',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'narrow-column-pair',
      [
        'H:4,3,5,4',
        'ID:calendar-main',
        'ID:tasks-main',
        'V:1,2',
        'ID:journal-main',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'narrow-column-pair',
      [
        'V:1,1,1,4',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:journal-main',
        'H',
        'ID:map-main',
        'ID:weather-main',
      ],
    ],
    [
      'bottom-strip',
      ['H:5,5,3', 'ID:calendar-main', 'ID:map-main', 'ID:weather-main'],
    ],
    [
      'bottom-strip-keep-row',
      ['H:5,5,3', 'ID:calendar-main', 'ID:map-main', 'ID:weather-main'],
    ],
  ])('%s fails on a tree a logged or recorded run shipped', (id, tree) => {
    const scenario = scenarios.find((candidate) => candidate.id === id);
    const rules = scenario?.expected.arrangement;
    if (scenario === undefined || rules === undefined)
      throw new Error(`no rules for ${id}`);
    expect(
      checkArrangement(rules, {
        request: scenario.request,
        tree: tree as TilingNode[],
      }).failures,
    ).not.toEqual([]);
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
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-inner-')),
    ).toHaveLength(8);
    expect(
      holdout.filter((scenario) => scenario.id.startsWith('hold-fresh-')),
    ).toHaveLength(11);
    for (const id of ['swap', 'big-right', 'top-and-pair', 'bottom-strip'])
      expect(
        development.find((scenario) => scenario.id === id)?.expected.status,
      ).toBe('planned');
  });
});
