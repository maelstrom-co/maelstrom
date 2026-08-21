import type { TilingNode } from '@maelstrom-co/protocol';
import { isTilingSplit, parseTilingSplitToken } from '@maelstrom-co/protocol';

import type { DroppedLayoutEntry, LayoutWarning } from '../healed-layout.js';

import type { Ast, StackFrame } from './ast.js';

/**
 * Iterative parse with explicit stack — adversarial input ('H' × 10k with
 * no leaves) cannot overflow. Returns the root AST (or null for empty
 * input) plus `consumedCount` so the orchestrator can detect leftover
 * tokens. Missing children produce `tree_missing_child` drops, deduped per
 * parent split (a split missing every child is one drop, not one per slot).
 *
 * A split token consumes as many subtrees as its weights declare, so a
 * miscount is detectable rather than silent: too few subtrees leaves the
 * frame short and reports a missing child, too many leaves tokens unconsumed
 * for the caller to report. Repairing a malformed weight suffix is a warning,
 * not a drop — nothing was removed from the layout. Cutting a token's arity
 * down to `MAX_SPLIT_CHILDREN` is a drop rather than a warning, because the
 * slots that went away take their subtrees with them: those subtrees are not
 * discarded, they are re-parented onto whichever ancestor still has an open
 * slot, which is a different layout rather than a differently proportioned
 * one.
 */
export function parseTree(
  tokens: readonly TilingNode[],
  drops: DroppedLayoutEntry[],
  warnings: LayoutWarning[],
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
      const { axis, weights, repaired, discardedChildCount } =
        parseTilingSplitToken(token);
      if (repaired) {
        warnings.push({
          kind: 'split_weights_repaired',
          atTokenIndex: i,
          token,
          weights,
        });
      }
      if (discardedChildCount > 0) {
        drops.push({
          reason: 'tree_split_truncated',
          atTokenIndex: i,
          declaredChildCount: weights.length + discardedChildCount,
          keptChildCount: weights.length,
        });
      }
      stack.push({ axis, weights, tokenIndex: i, filled: [] });
      continue;
    }

    // Explicit null check; the else branch narrows to InstanceId since
    // isTilingSplit ruled out every split token.
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
      top.filled.push({ weight: nextSlotWeight(top), node: subtree });
      if (top.filled.length < top.weights.length) break;
      // Arity reached: pop, combine, continue bubbling into the parent.
      stack.pop();
      subtree = {
        kind: 'split',
        tokenIndex: top.tokenIndex,
        axis: top.axis,
        children: top.filled,
      };
    }
  }

  // Unwind frames left after we ran out of tokens. Each still has empty child
  // slots; a subtree bubbling up from a deeper frame fills the next one.
  let pending: Ast | null = root;
  while (stack.length > 0) {
    // biome-ignore lint/style/noNonNullAssertion: stack.length > 0 is the loop condition
    const frame = stack.pop()!;
    const survivors =
      pending === null
        ? frame.filled
        : [...frame.filled, { weight: nextSlotWeight(frame), node: pending }];

    if (
      survivors.length < frame.weights.length &&
      !reportedMissingAt.has(frame.tokenIndex)
    ) {
      drops.push({
        reason: 'tree_missing_child',
        atTokenIndex: frame.tokenIndex,
      });
      reportedMissingAt.add(frame.tokenIndex);
    }

    // A split reduced to one surviving child is that child; reduced to none,
    // it is nothing at all.
    const onlySurvivor = survivors[0];
    if (onlySurvivor === undefined) {
      pending = null;
    } else if (survivors.length === 1) {
      pending = onlySurvivor.node;
    } else {
      pending = {
        kind: 'split',
        tokenIndex: frame.tokenIndex,
        axis: frame.axis,
        children: survivors,
      };
    }
  }

  if (root === null && pending !== null) root = pending;

  return { ast: root, consumedCount };
}

/**
 * The weight declared for the next slot to be filled. A frame combines and
 * pops the moment `filled.length` reaches `weights.length`, so a frame that is
 * still on the stack always has that slot.
 */
function nextSlotWeight(frame: StackFrame): number {
  // biome-ignore lint/style/noNonNullAssertion: filled.length < weights.length holds for every frame still on the stack
  return frame.weights[frame.filled.length]!;
}
