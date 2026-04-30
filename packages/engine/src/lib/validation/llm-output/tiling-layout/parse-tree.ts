import type { TilingNode } from '@maelstrom-co/protocol';
import { isTilingSplit } from '@maelstrom-co/protocol';

import type { DroppedLayoutEntry } from '../healed-layout.js';

import type { Ast, StackFrame } from './ast.js';

/**
 * Iterative parse with explicit stack — adversarial input ('H' × 10k with
 * no leaves) cannot overflow. Returns the root AST (or null for empty
 * input) plus `consumedCount` so the orchestrator can detect leftover
 * tokens. Missing children produce `tree_missing_child` drops, deduped per
 * parent split (a split missing both children is one drop, not two).
 */
export function parseTree(
  tokens: readonly TilingNode[],
  drops: DroppedLayoutEntry[],
): { ast: Ast | null; consumedCount: number } {
  if (tokens.length === 0) return { ast: null, consumedCount: 0 };

  const stack: StackFrame[] = [];
  let root: Ast | null = null;
  let consumedCount = 0;
  const reportedMissingAt = new Set<number>();
  let rootDone = false;

  for (let i = 0; i < tokens.length; i++) {
    if (rootDone) break;
    consumedCount = i + 1;
    const token = tokens[i];
    if (token === undefined) continue;

    if (isTilingSplit(token)) {
      stack.push({ kind: 'await-left', dir: token, tokenIndex: i });
      continue;
    }

    // Explicit null check; the else branch narrows to InstanceId since
    // isTilingSplit ruled out 'H' | 'V'.
    let subtree: Ast =
      token === null
        ? { kind: 'null_leaf', tokenIndex: i }
        : { kind: 'leaf', tokenIndex: i, id: token };

    while (true) {
      const top = stack[stack.length - 1];
      if (top === undefined) {
        root = subtree;
        rootDone = true;
        break;
      }
      if (top.kind === 'await-left') {
        stack[stack.length - 1] = {
          kind: 'await-right',
          dir: top.dir,
          tokenIndex: top.tokenIndex,
          leftSubtree: subtree,
        };
        break;
      }
      // await-right: pop, combine, continue bubbling.
      stack.pop();
      subtree = {
        kind: 'split',
        tokenIndex: top.tokenIndex,
        dir: top.dir,
        left: top.leftSubtree,
        right: subtree,
      };
    }
  }

  // Unwind frames left after we ran out of tokens. Each represents a
  // missing child slot.
  let pending: Ast | null = root;
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === 'await-right') {
      if (pending === null) {
        if (!reportedMissingAt.has(frame.tokenIndex)) {
          drops.push({
            reason: 'tree_missing_child',
            atTokenIndex: frame.tokenIndex,
          });
          reportedMissingAt.add(frame.tokenIndex);
        }
        pending = frame.leftSubtree;
      } else {
        pending = {
          kind: 'split',
          tokenIndex: frame.tokenIndex,
          dir: frame.dir,
          left: frame.leftSubtree,
          right: pending,
        };
      }
      continue;
    }
    // await-left: left never arrived; right is also missing. The split is
    // a single missing-child report, dedup-aware.
    if (!reportedMissingAt.has(frame.tokenIndex)) {
      drops.push({
        reason: 'tree_missing_child',
        atTokenIndex: frame.tokenIndex,
      });
      reportedMissingAt.add(frame.tokenIndex);
    }
    // If pending bubbled up from inside this split, treat it as the
    // surviving (left) child and collapse to it.
  }

  if (root === null && pending !== null) root = pending;

  return { ast: root, consumedCount };
}
