import type { InstanceId, TilingSplit } from '@maelstrom-co/protocol';

/**
 * Internal AST built by {@link ./parse-tree.ts:parseTree}. Three node kinds:
 * `leaf` (an instance reference), `null_leaf` (explicit empty space), and
 * `split` (an `H`/`V` divider). `tokenIndex` is the source position in
 * the LLM-emitted tree array; preserved so drop entries and orphan-reference
 * diagnostics can cite the original index.
 */
export type Ast =
  | {
      readonly kind: 'leaf';
      readonly tokenIndex: number;
      readonly id: InstanceId;
    }
  | { readonly kind: 'null_leaf'; readonly tokenIndex: number }
  | {
      readonly kind: 'split';
      readonly tokenIndex: number;
      readonly axis: TilingSplit;
      readonly children: readonly SplitChild[];
    };

/**
 * One child slot of a split, carrying the weight the split declared for it.
 *
 * Pairing the two makes a weight-count / child-count mismatch unrepresentable:
 * a split that lost children to a truncated token array loses their weights
 * with them, and no consumer has to invent a weight for a slot the split never
 * declared.
 */
export interface SplitChild {
  readonly weight: number;
  readonly node: Ast;
}

/**
 * Parser state machine frame, pushed on encountering a split token and popped
 * once `filled` reaches the arity its weights declare. Each resolved subtree
 * appends to `filled`, paired with the weight for the slot it lands in.
 * Iterative parse uses an explicit stack of these frames so adversarial input
 * ('H' × 10k with no leaves) cannot overflow.
 */
export interface StackFrame {
  readonly axis: TilingSplit;
  readonly weights: readonly number[];
  readonly tokenIndex: number;
  readonly filled: SplitChild[];
}

/**
 * Pruner task-queue entry. `visit` schedules an AST node for processing;
 * `combine` consumes one result per declared weight from the value stack and
 * pushes a single combined result. Iterative post-order pruning uses these
 * tasks so deep AST shapes (long right spines) don't risk stack overflow.
 */
export type PruneTask =
  | { readonly op: 'visit'; readonly node: Ast }
  | {
      readonly op: 'combine';
      readonly axis: TilingSplit;
      readonly weights: readonly number[];
    };
