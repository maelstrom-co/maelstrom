import type {
  ChartRequest,
  InstanceId,
  Result,
  TilingNode,
  TilingResponse,
  Vessel,
} from '@maelstrom-co/protocol';
import { err, isInstanceIdNode, ok } from '@maelstrom-co/protocol';

import type {
  LayoutValidationError,
  LayoutValidationFailure,
} from '../../errors.js';
import { layoutValidationError } from '../../errors.js';
import { checkRationale, findDuplicateInstanceIds } from './common.js';

export function validateTilingLayout(
  response: TilingResponse,
  request: ChartRequest,
): Result<void, LayoutValidationError> {
  const failures: LayoutValidationFailure[] = [];

  checkRationale(response.rationale, failures);

  const instanceIds = response.layout.instances.map((i) => i.instanceId);
  for (const dup of findDuplicateInstanceIds(instanceIds)) {
    failures.push({ kind: 'duplicate_instance_id', instanceId: dup });
  }

  const vesselById = new Map<string, Vessel>();
  for (const vessel of request.vessels) {
    vesselById.set(vessel.id, vessel);
  }

  for (const instance of response.layout.instances) {
    const vessel = vesselById.get(instance.vesselId);
    if (!vessel) {
      failures.push({
        kind: 'unknown_vessel',
        instanceId: instance.instanceId,
        vesselId: instance.vesselId,
      });
      continue;
    }
    if (!(instance.variant in vessel.variants)) {
      failures.push({
        kind: 'unknown_variant',
        instanceId: instance.instanceId,
        variant: instance.variant,
      });
    }
  }

  // Wire → branded boundary: Zod infers the tree as `(string | null)[]`
  // because `TilingNodeSchema` cannot carry the `InstanceId` brand. Cast once
  // here so downstream helpers operate on the canonical branded `TilingNode`.
  const tree = response.layout.tree as readonly TilingNode[];
  const treeFailures = validateTreeStructure(tree);
  failures.push(...treeFailures);

  if (treeFailures.length === 0) {
    const declared = new Set(instanceIds);
    const referenced = collectLeafIds(tree);
    for (const id of referenced) {
      if (!declared.has(id)) {
        failures.push({ kind: 'orphan_tree_reference', instanceId: id });
      }
    }
  }

  return failures.length === 0
    ? ok(undefined)
    : err(layoutValidationError(failures));
}

// Parses the preorder-serialized tiling tree iteratively with an explicit
// stack so adversarial LLM output (thousands of nested 'H'/'V' tokens with no
// leaves) cannot overflow the JS call stack. Each stack slot records the
// parent split's token index so missing-child failures can be attributed back
// to the exact split they describe.
//
// Root's parent is `-1` by convention; an empty tree is caught by the
// early-return before any slot is pushed.
function validateTreeStructure(
  tree: readonly TilingNode[],
): LayoutValidationFailure[] {
  if (tree.length === 0) return [];

  const failures: LayoutValidationFailure[] = [];
  // Dedup per parent split: a single split missing both children is one
  // conceptual failure, not two, from a retry-prompt perspective.
  const reportedMissingAt = new Set<number>();
  const pending: number[] = [-1];
  let index = 0;

  while (pending.length > 0) {
    const parentSplitIndex = pending.pop()!;
    if (index >= tree.length) {
      if (!reportedMissingAt.has(parentSplitIndex)) {
        failures.push({
          kind: 'tree_missing_child',
          atTokenIndex: parentSplitIndex,
        });
        reportedMissingAt.add(parentSplitIndex);
      }
      continue;
    }
    const node = tree[index++];
    if (node === 'H' || node === 'V') {
      const splitIndex = index - 1;
      // Push right before left so left pops first (preorder).
      pending.push(splitIndex, splitIndex);
    }
  }

  if (index < tree.length) {
    failures.push({
      kind: 'tree_extra_tokens',
      unconsumedCount: tree.length - index,
    });
  }

  return failures;
}

function collectLeafIds(tree: readonly TilingNode[]): readonly InstanceId[] {
  const ids: InstanceId[] = [];
  for (const node of tree) {
    if (isInstanceIdNode(node)) {
      ids.push(node);
    }
  }
  return ids;
}
