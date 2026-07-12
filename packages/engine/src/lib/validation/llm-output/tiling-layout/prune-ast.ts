import type { InstanceId, TilingNode } from '@maelstrom-co/protocol';

import { assertNever } from '../../../assert-never.js';
import type { DroppedLayoutEntry } from '../healed-layout.js';

import type { Ast, PruneTask } from './ast.js';

/**
 * Iterative post-order prune. Avoids recursion entirely so legal-but-deep
 * AST shapes (e.g. an N-deep right spine of splits + leaves) don't risk
 * stack overflow even when token count is large. Orphan instance leaves
 * (referencing IDs not in `validIds`) become `tree_orphan_reference` drops
 * and collapse to nothing; splits whose subtrees both pruned to empty
 * collapse to nothing as well.
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
      // A 'split' always pushes combine, then visit(right), then visit(left)
      // (LIFO), so left resolves first and its result sits below right's on
      // the results stack — both are guaranteed present here.
      // biome-ignore lint/style/noNonNullAssertion: paired visit(right) result guaranteed pushed before this combine runs
      const right = results.pop()!;
      // biome-ignore lint/style/noNonNullAssertion: paired visit(left) result guaranteed pushed before this combine runs
      const left = results.pop()!;
      if (left.length === 0 && right.length === 0) {
        results.push([]);
      } else if (left.length === 0) {
        results.push(right);
      } else if (right.length === 0) {
        results.push(left);
      } else {
        results.push([task.dir, ...left, ...right]);
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
        // Schedule children first (LIFO so left runs before right),
        // then a combine task that consumes their two results.
        work.push({ op: 'combine', dir: node.dir });
        work.push({ op: 'visit', node: node.right });
        work.push({ op: 'visit', node: node.left });
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
