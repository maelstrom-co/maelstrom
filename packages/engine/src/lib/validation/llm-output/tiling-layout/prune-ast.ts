import type { InstanceId, TilingNode } from '@maelstrom-co/protocol';
import { formatTilingSplitToken } from '@maelstrom-co/protocol';

import { assertNever } from '../../../assert-never.js';
import type { DroppedLayoutEntry } from '../healed-layout.js';

import type { Ast, PruneTask } from './ast.js';

/**
 * Iterative post-order prune. Avoids recursion entirely so legal-but-deep
 * AST shapes (e.g. a deep chain of nested splits) don't risk stack overflow
 * even when token count is large. Orphan instance leaves
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

  const work: PruneTask[] = [
    { op: 'visit', weight: ROOT_SLOT_WEIGHT, node: ast },
  ];
  const results: PrunedSlot[] = [];

  while (work.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: work.length > 0 is the loop condition
    const task = work.pop()!;
    if (task.op === 'combine') {
      // A 'split' pushes combine, then visit(child) for each child in reverse
      // (LIFO), so children resolve left to right and their slots sit on the
      // stack in that order — one per child, all present here. Popping walks
      // them right to left, so collect and then reverse.
      const survivors: PrunedSlot[] = [];
      for (let i = 0; i < task.childCount; i++) {
        // biome-ignore lint/style/noNonNullAssertion: one visit result per child is on the stack before its combine runs
        const child = results.pop()!;
        if (child.tokens.length > 0) survivors.push(child);
      }
      survivors.reverse();

      const [first, second, ...rest] = survivors;
      if (first === undefined) {
        results.push({ weight: task.weight, tokens: [] });
      } else if (second === undefined) {
        results.push({ weight: task.weight, tokens: first.tokens });
      } else {
        results.push({
          weight: task.weight,
          tokens: [
            formatTilingSplitToken(task.axis, [
              first.weight,
              second.weight,
              ...rest.map(({ weight }) => weight),
            ]),
            ...survivors.flatMap(({ tokens }) => tokens),
          ],
        });
      }
      continue;
    }

    const node = task.node;
    switch (node.kind) {
      case 'null_leaf':
        results.push({ weight: task.weight, tokens: [null] });
        continue;
      case 'leaf':
        if (validIds.has(node.id)) {
          results.push({ weight: task.weight, tokens: [node.id] });
        } else {
          drops.push({
            reason: 'tree_orphan_reference',
            atTokenIndex: node.tokenIndex,
            instanceId: node.id,
          });
          results.push({ weight: task.weight, tokens: [] });
        }
        continue;
      case 'split':
        // Schedule children first (LIFO so they run left to right),
        // then a combine task that consumes all their results.
        work.push({
          op: 'combine',
          axis: node.axis,
          weight: task.weight,
          childCount: node.children.length,
        });
        for (let i = node.children.length - 1; i >= 0; i--) {
          // biome-ignore lint/style/noNonNullAssertion: index is bounded by children.length
          const child = node.children[i]!;
          work.push({ op: 'visit', weight: child.weight, node: child.node });
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
  return result.tokens;
}

/** The root has no parent split, so nothing ever reads the weight it carries. */
const ROOT_SLOT_WEIGHT = 1;

/**
 * A pruned subtree paired with the weight of the slot it occupies, so the
 * combine step never has to look a weight up by index.
 */
interface PrunedSlot {
  readonly weight: number;
  readonly tokens: TilingNode[];
}
