import type { InstanceId } from '@maelstrom-co/protocol';

/**
 * Internal AST built by {@link ./parse-tree.ts:parseTree}. Three node kinds:
 * `leaf` (an instance reference), `null_leaf` (explicit empty space), and
 * `split` (binary `H`/`V` divider). `tokenIndex` is the source position in
 * the LLM-emitted tree array; preserved so drop entries and orphan-reference
 * diagnostics can cite the original index.
 */
export type Ast =
  | { readonly kind: 'leaf'; readonly tokenIndex: number; readonly id: InstanceId }
  | { readonly kind: 'null_leaf'; readonly tokenIndex: number }
  | {
      readonly kind: 'split';
      readonly tokenIndex: number;
      readonly dir: 'H' | 'V';
      readonly left: Ast;
      readonly right: Ast;
    };

/**
 * Parser state machine frame. `await-left` is pushed on encountering a
 * split operator; transitions to `await-right` after the left subtree
 * resolves; pops on the right subtree resolving (combining into a `split`
 * node). Iterative parse uses an explicit stack of these frames so
 * adversarial input ('H' × 10k with no leaves) cannot overflow.
 */
export type StackFrame =
  | { readonly kind: 'await-left'; readonly dir: 'H' | 'V'; readonly tokenIndex: number }
  | {
      readonly kind: 'await-right';
      readonly dir: 'H' | 'V';
      readonly tokenIndex: number;
      readonly leftSubtree: Ast;
    };

/**
 * Pruner task-queue entry. `visit` schedules an AST node for processing;
 * `combine` consumes the two most recent results from the value stack and
 * pushes a single combined result. Iterative post-order pruning uses these
 * tasks so deep AST shapes (long right spines) don't risk stack overflow.
 */
export type PruneTask =
  | { readonly op: 'visit'; readonly node: Ast }
  | { readonly op: 'combine'; readonly dir: 'H' | 'V' };
