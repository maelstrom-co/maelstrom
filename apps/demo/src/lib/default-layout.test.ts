import type { TilingTreeNode } from '@maelstrom-co/client';
import { parseTilingTree } from '@maelstrom-co/client';
import { type InstanceId, isInstanceIdNode } from '@maelstrom-co/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calendarVessel } from '../vessels/calendar.vessel';
import { tasksVessel } from '../vessels/tasks.vessel';
import { DEFAULT_LAYOUT, NARROW_LAYOUT } from './default-layout';

// Walks the parsed tree, asserting every split node filled every child slot
// its weights declare (a malformed tree — e.g. a 'V' with only one leaf —
// silently drops a tile at runtime instead of failing loudly), and collects
// the leaf instance ids.
function assertCompleteAndCollectLeaves(node: TilingTreeNode | null): string[] {
  if (node === null) {
    throw new Error('expected a non-null tiling tree');
  }
  if (node.type === 'leaf') {
    expect(node.instanceId).not.toBeNull();
    return node.instanceId === null ? [] : [node.instanceId];
  }
  expect(node.children).toHaveLength(node.weights.length);
  return node.children.flatMap((child) => {
    expect(child).toBeDefined();
    return child ? assertCompleteAndCollectLeaves(child) : [];
  });
}

describe('DEFAULT_LAYOUT', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses into a complete tiling tree with no dangling splits', () => {
    // A malformed constant (e.g. a split missing a child) would surface as
    // a blank first screen at runtime with nothing but a console.warn —
    // round-trip it through the real parser here instead.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tree = parseTilingTree(DEFAULT_LAYOUT.tree);
    const leaves = assertCompleteAndCollectLeaves(tree);

    expect(new Set(leaves)).toEqual(new Set(['calendar-main', 'tasks-main']));
    expect(warn).not.toHaveBeenCalled();
  });

  it('declares every instance its tree references', () => {
    const declared = DEFAULT_LAYOUT.instances.map(
      (instance) => instance.instanceId as string,
    );
    const leaves: InstanceId[] = DEFAULT_LAYOUT.tree.filter(isInstanceIdNode);

    expect(leaves.length).toBeGreaterThan(0);
    // Both directions: every leaf is declared (above) and every declared
    // instance is referenced by the tree (below) — an entry in `instances`
    // with no token in `tree` renders nowhere but still suppresses the
    // first-run hint. Ids must also be unique for the set comparison to be
    // meaningful.
    expect(new Set(declared)).toEqual(new Set(leaves));
    expect(declared.length).toBe(new Set(declared).size);
  });

  it('names variants that exist on their vessels', () => {
    // Reads variants off the real vessel definitions rather than a
    // hand-copied list, so renaming or removing a variant there (e.g.
    // calendar's 'day') fails this test instead of only failing at runtime.
    const vesselsById = {
      calendar: calendarVessel,
      tasks: tasksVessel,
    } as const;

    for (const instance of DEFAULT_LAYOUT.instances) {
      const vessel = vesselsById[instance.vesselId as keyof typeof vesselsById];
      expect(vessel).toBeDefined();
      expect(Object.keys(vessel.variants)).toContain(instance.variant);
    }
  });

  it('stacks the seeded vessels on narrow chart containers', () => {
    const tree = parseTilingTree(NARROW_LAYOUT.tree);

    expect(tree?.type).toBe('split');
    if (tree?.type !== 'split') throw new Error('expected a split layout');
    expect(tree.direction).toBe('H');
    expect(new Set(assertCompleteAndCollectLeaves(tree))).toEqual(
      new Set(['calendar-main', 'tasks-main']),
    );
    expect(NARROW_LAYOUT.instances).toEqual(DEFAULT_LAYOUT.instances);
  });
});
