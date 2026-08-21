import type {
  ChartRequest,
  InstanceId,
  TilingNode,
  TilingResponse,
  Vessel,
  VesselId,
} from '@maelstrom-co/protocol';

import {
  findDuplicateTilingLeaf,
  isInstanceIdNode,
} from '@maelstrom-co/protocol';

import {
  pushMissingRationaleWarningIfEmpty,
  seenInstancesTracker,
} from './heal-common.js';
import type {
  DroppedLayoutEntry,
  HealedTilingInstance,
  HealedTilingLayout,
  LayoutWarning,
} from './healed-layout.js';
import { parseTree } from './tiling-layout/parse-tree.js';
import { pruneAst } from './tiling-layout/prune-ast.js';

/**
 * Recovery rules:
 * - Duplicate instanceId → keep the first occurrence; subsequent duplicates
 *   become `duplicate_instance_id` drops without further validation.
 * - Unknown vessel / variant → drop the instance (kept out of the healed
 *   `instances` array and pruned from the tree downstream).
 * - Duplicate tree leaf → keep the first preorder occurrence and drop the
 *   token that repeats it. An Instance is one store entry with one Variant
 *   and one action surface, and tiles are keyed by Instance ID, so a tree
 *   naming it twice has no rendering. Removing the token leaves its parent
 *   split a child short, which the parser reports and collapses.
 * - Tree shape errors (missing child / orphan reference / extra tokens /
 *   duplicate leaf) are reported as `tree_*` drops; the iterative parser +
 *   pruner produce a renderable tree that elides the broken pieces.
 * - Malformed split weights → warning, repaired in place. Nothing is dropped,
 *   because a split's arity is exactly what could not be read.
 * - missing rationale → warning, response accepted as-is.
 */
export function healTilingLayout(
  response: TilingResponse,
  request: ChartRequest,
): HealedTilingLayout {
  const droppedEntries: DroppedLayoutEntry[] = [];
  const warnings: LayoutWarning[] = [];

  pushMissingRationaleWarningIfEmpty(response, warnings);

  const vesselById = new Map<VesselId, Vessel>();
  for (const vessel of request.vessels) vesselById.set(vessel.id, vessel);

  const tracker = seenInstancesTracker(droppedEntries);
  const healedInstances: HealedTilingInstance[] = [];
  for (const instance of response.layout.instances) {
    const instanceId = instance.instanceId;

    if (tracker.isDuplicate(instanceId)) continue;

    const vessel = vesselById.get(instance.vesselId);
    if (!vessel) {
      droppedEntries.push({
        reason: 'unknown_vessel',
        instanceId,
        vesselId: instance.vesselId,
      });
      continue;
    }
    if (!(instance.variant in vessel.variants)) {
      droppedEntries.push({
        reason: 'unknown_variant',
        instanceId,
        variant: instance.variant,
      });
      continue;
    }
    healedInstances.push({
      instanceId,
      vesselId: instance.vesselId,
      variant: instance.variant,
    });
    tracker.markSeen(instanceId);
  }

  const rawTree: readonly TilingNode[] = response.layout.tree;
  const treeTokens =
    findDuplicateTilingLeaf(rawTree) === null
      ? rawTree
      : withoutDuplicateLeaves(rawTree, droppedEntries);
  const { ast, consumedCount } = parseTree(
    treeTokens,
    droppedEntries,
    warnings,
  );

  if (consumedCount < treeTokens.length) {
    droppedEntries.push({
      reason: 'tree_extra_tokens',
      fromTokenIndex: consumedCount,
      count: treeTokens.length - consumedCount,
    });
  }

  const validIds = new Set<InstanceId>(
    healedInstances.map((i) => i.instanceId),
  );
  const healedTree = pruneAst(ast, validIds, droppedEntries);

  return {
    mode: 'tiling',
    layout: { tree: healedTree, instances: healedInstances },
    droppedEntries,
    warnings,
  };
}

/**
 * Removes every token that repeats an earlier Instance leaf, in one pass.
 *
 * Reported indices are positions in the input array. Downstream `tree_*` drops
 * cite positions in the array returned here, which the removals have shifted;
 * tree-class drops are collapsed to a single advisory rather than cited by
 * index, so the shift is not observable.
 */
function withoutDuplicateLeaves(
  tree: readonly TilingNode[],
  drops: DroppedLayoutEntry[],
): readonly TilingNode[] {
  const seen = new Set<InstanceId>();
  const kept: TilingNode[] = [];

  tree.forEach((node, atTokenIndex) => {
    if (isInstanceIdNode(node)) {
      if (seen.has(node)) {
        drops.push({
          reason: 'tree_duplicate_leaf',
          atTokenIndex,
          instanceId: node,
        });
        return;
      }
      seen.add(node);
    }
    kept.push(node);
  });

  return kept;
}
