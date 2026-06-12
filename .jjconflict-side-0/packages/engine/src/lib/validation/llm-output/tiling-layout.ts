import type {
  ChartRequest,
  InstanceId,
  TilingNode,
  TilingResponse,
  Vessel,
  VesselId,
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
 * - Tree shape errors (missing child / orphan reference / extra tokens)
 *   are reported as `tree_*` drops; the iterative parser + pruner produce
 *   a renderable tree that elides the broken pieces.
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

  // Zod infers the tree as `(string | null)[]` because TilingNodeSchema
  // cannot carry the InstanceId brand. Cast once here so downstream
  // helpers operate on the canonical branded TilingNode.
  const treeTokens = response.layout.tree as readonly TilingNode[];
  const { ast, consumedCount } = parseTree(treeTokens, droppedEntries);

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
