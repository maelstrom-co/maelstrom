import { describe, expect, test } from 'bun:test';

import { treeRects as plannerTreeRects } from '@maelstrom-co/planner-jev/_eval';
import { demoVessels as plannerDemoVessels } from '@maelstrom-co/planner-jev/_testing';
import type { TilingNode } from '@maelstrom-co/protocol';
import { demoVessels } from '../../core/fixtures/demo-vessels.js';
import { treeRects } from '../../core/geometry.js';
import { scenarios } from '../../core/scenarios.js';

/**
 * Eval core cannot import planner-jev, so it keeps copies of the planner's
 * geometry and demo catalog; these tests hold the copies equal.
 */
describe('core copies of planner-jev helpers', () => {
  test('treeRects agrees with the planner on every scenario tree, malformed ones included', () => {
    const trees = scenarios.flatMap((scenario) => {
      const current =
        scenario.request.layout.type === 'tiling'
          ? [scenario.request.layout.tree]
          : [];
      const expected = scenario.expected.tree
        ? [scenario.expected.tree as TilingNode[]]
        : [];
      return [...current, ...expected].map((tree) => ({ scenario, tree }));
    });
    expect(trees.length).toBeGreaterThan(20);
    for (const { scenario, tree } of trees)
      expect(treeRects(scenario.request, tree)).toEqual(
        plannerTreeRects(scenario.request, tree),
      );
    const [first] = scenarios;
    if (!first) throw new Error('no scenarios');
    for (const malformed of [
      ['V:1,1', 'ID:calendar-main'],
      ['ID:calendar-main', 'ID:map-main'],
      ['H', 'ID:calendar-main', 'nonsense'],
    ] as TilingNode[][])
      expect(treeRects(first.request, malformed)).toEqual(
        plannerTreeRects(first.request, malformed),
      );
  });

  test('the demo Vessel snapshot is the planner test fixture', () => {
    expect(demoVessels).toEqual(plannerDemoVessels);
  });
});
