import type { InstanceId, TilingNode } from '@maelstrom-co/protocol';
import { formatTilingSplitToken } from '@maelstrom-co/protocol';

import { assertNever } from '../../../assert-never.js';
import type { DroppedLayoutEntry } from '../healed-layout.js';

import type { Ast, PruneTask } from './ast.js';

/**
 * Iterative post-order prune. Avoids recursion entirely so legal-but-deep
 * AST shapes (e.g. an N-deep right spine of splits + leaves) don't risk
 * stack overflow even when token count is large. Orphan instance leaves
 * (referencing IDs not in `validIds`) become `tree_orphan_reference` drops
 * and collapse to nothing; a split drops the weight of every child that
 * pruned to empty, collapses to its single survivor when only one is left,
 * and to nothing when none is.
 */
export function pruneAst(
  ast: Ast | null,
  validIds: ReadonlySet<InstanceId>,
  drops: DroppedLayoutEntry[],
): TilingNode[] {
  if (ast === null) return [];

  const work: PruneTask[] = [{ op: 'visit', node: ast }];
  const results: TilingNode[][] = [];

  while (work.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: work.length > 0 is the loop condition
    const task = work.pop()!;
    if (task.op === 'combine') {
      // A 'split' pushes combine, then visit(child) for each child in reverse
      // (LIFO), so children resolve left to right and their results sit on the
      // stack in that order — all `childCount` are guaranteed present here.
      const children: TilingNode[][] = [];
      for (let i = 0; i < task.childCount; i++) {
        // biome-ignore lint/style/noNonNullAssertion: paired visit results guaranteed pushed before this combine runs
        children.push(results.pop()!);
      }
      children.reverse();

      const survivingWeights: number[] = [];
      const survivingChildren: TilingNode[][] = [];
      children.forEach((child, index) => {
        if (child.length === 0) return;
        survivingChildren.push(child);
        survivingWeights.push(task.weights[index] ?? 1);
      });

      const onlyChild = survivingChildren[0];
      if (onlyChild === undefined) {
        results.push([]);
      } else if (survivingChildren.length === 1) {
        results.push(onlyChild);
      } else {
        results.push([
          formatTilingSplitToken(task.axis, survivingWeights),
          ...survivingChildren.flat(),
        ]);
      }
      continue;
    }

    const node = task.node;
    switch (node.kind) {
      case 'null_leaf':
        results.push([null]);
        continue;
      case 'leaf':
        if (validIds.has(node.id)) {
          results.push([node.id]);
        } else {
          drops.push({
            reason: 'tree_orphan_reference',
            atTokenIndex: node.tokenIndex,
            instanceId: node.id,
          });
          results.push([]);
        }
        continue;
      case 'split':
        // Schedule children first (LIFO so they run left to right),
        // then a combine task that consumes all their results.
        work.push({
          op: 'combine',
          axis: node.axis,
          weights: node.weights,
          childCount: node.children.length,
        });
        for (let i = node.children.length - 1; i >= 0; i--) {
          // biome-ignore lint/style/noNonNullAssertion: index is bounded by children.length
          work.push({ op: 'visit', node: node.children[i]! });
        }
        continue;
      default:
        assertNever(node, 'pruneAst');
    }
  }

  const result = results[0];
  if (results.length !== 1 || result === undefined) {
    throw new Error(
      `pruneAst invariant violation: expected 1 result, got ${results.length}`,
    );
  }
  return result;
}
