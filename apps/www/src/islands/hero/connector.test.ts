import { describe, expect, it } from 'bun:test';
import {
  type TilingLayout,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';
import { createHeroConnector } from './connector';

// Instance IDs referenced as leaves in the tiling tree (drop split markers).
const treeLeaves = (layout: TilingLayout) =>
  layout.tree
    .map(tilingLeafInstanceId)
    .filter((instanceId) => instanceId !== null);

// Every declared instance must appear as a tree leaf and vice versa — a hero
// tile whose leaf has no matching instance renders broken, and the hero is the
// first thing every visitor sees.
const assertNoDrift = (layout: TilingLayout) => {
  expect(new Set(treeLeaves(layout))).toEqual(
    new Set(layout.instances.map((inst) => inst.instanceId)),
  );
};

describe('createHeroConnector', () => {
  for (const isMobile of [false, true]) {
    const label = isMobile ? 'mobile' : 'desktop';
    it(`has no tree/instance drift in any ${label} step`, () => {
      for (const step of createHeroConnector(isMobile).steps) {
        assertNoDrift(step.layout);
      }
    });
  }

  it('keeps every mobile step to a single column of at most two cards', () => {
    for (const step of createHeroConnector(true).steps) {
      expect(step.layout.instances.length).toBeLessThanOrEqual(2);
    }
  });

  it('gives every step a prompt except the initial layout', () => {
    const steps = createHeroConnector(false).steps;
    const prompted = steps.filter((step) => step.prompt !== undefined);
    expect(steps[0].prompt).toBeUndefined();
    expect(prompted.length).toBe(steps.length - 1);
  });
});
