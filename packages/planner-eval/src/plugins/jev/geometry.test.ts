import { describe, expect, test } from 'bun:test';

import {
  finalVariants as plannerFinalVariants,
  treeRects as plannerTreeRects,
} from '@maelstrom-co/planner-jev/_eval';
import { demoVessels as plannerDemoVessels } from '@maelstrom-co/planner-jev/_testing';
import type {
  ActionName,
  InstanceId,
  TilingNode,
} from '@maelstrom-co/protocol';
import { finalVariants } from '../../core/final-variants.js';
import { demoVessels } from '../../core/fixtures/demo-vessels.js';
import { treeRects } from '../../core/geometry.js';
import { scenarios } from '../../core/scenarios.js';

/**
 * The core keeps its own copies of the planner's geometry, variant
 * simulation and demo catalog so it never imports the planner it measures;
 * these tests hold the copies equal to the planner's.
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

  test('finalVariants agrees with the planner on every expected action plan', () => {
    let compared = 0;
    for (const scenario of scenarios) {
      const actions = (scenario.expected.actions ?? []).map((action) => ({
        instanceId: action.instanceId as InstanceId,
        action: action.action as ActionName,
      }));
      const { instances, vessels } = scenario.request;
      expect(finalVariants(instances, actions, vessels)).toEqual(
        plannerFinalVariants(instances, actions, vessels),
      );
      compared += 1;
    }
    expect(compared).toBe(scenarios.length);
    const [first] = scenarios;
    if (!first) throw new Error('no scenarios');
    const unknown = [
      { instanceId: 'ghost' as InstanceId, action: 'showWeek' as ActionName },
    ];
    expect(
      finalVariants(first.request.instances, unknown, first.request.vessels),
    ).toEqual(
      plannerFinalVariants(
        first.request.instances,
        unknown,
        first.request.vessels,
      ),
    );
  });

  test('the demo Vessel snapshot is the planner test fixture', () => {
    expect(demoVessels).toEqual(plannerDemoVessels);
  });
});
