import type {
  ChartRequest,
  InstanceId,
  TilingNode,
  TilingResponse,
  Vessel,
  VesselId,
} from '@maelstrom-co/protocol';

import { findDuplicateTilingLeaves } from '@maelstrom-co/protocol';

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
 * - Duplicate tree leaf → keep the first preorder occurrence and blank the
 *   token that repeats it to `null`. An Instance is one store entry with one
 *   Variant and one action surface, and tiles are keyed by Instance ID, so a
 *   tree naming it twice has no rendering. Blanking rather than removing keeps
 *   the parent's arity and every sibling's position intact, so the healed
 *   layout differs from the model's by one empty tile instead of being a
 *   different layout.
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

  const treeTokens = withDuplicateLeavesBlanked(
    response.layout.tree,
    droppedEntries,
  );
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
 * Replaces every token that repeats an earlier Instance leaf with `null`.
 *
 * `null` is the grammar's own token for a child slot that names no Instance,
 * so substituting it costs the repeat its tile and nothing else: the parent
 * split keeps the arity it declared, every following token keeps its position,
 * and the whole pipeline stays in one index coordinate space — the indices
 * reported here are directly comparable to the ones downstream `tree_*` drops
 * and `split_weights_repaired` warnings cite.
 *
 * Deleting the token instead would re-parent the entire remainder of the
 * preorder array: `['H','V','a','a','V','b','c']` would heal to a two-row
 * layout whose top-level axis had flipped.
 */
function withDuplicateLeavesBlanked(
  tree: readonly TilingNode[],
  drops: DroppedLayoutEntry[],
): readonly TilingNode[] {
  const duplicates = findDuplicateTilingLeaves(tree);
  if (duplicates.length === 0) return tree;

  const blankedIndices = new Set<number>();
  for (const { instanceId, atTokenIndex } of duplicates) {
    blankedIndices.add(atTokenIndex);
    drops.push({ reason: 'tree_duplicate_leaf', atTokenIndex, instanceId });
  }

  return tree.map((node, index) => (blankedIndices.has(index) ? null : node));
}
