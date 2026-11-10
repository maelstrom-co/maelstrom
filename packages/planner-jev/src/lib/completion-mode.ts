/**
 * How the final completion call runs: `skip` makes no call, `replyless`
 * makes the call without asking for `userMessage`, `full` makes the whole call.
 */
export type CompletionMode = 'skip' | 'replyless' | 'full';

/** What decides the completion mode of a request. */
export interface CompletionModeInput {
  /** The request's `skipReply` flag; `undefined` counts as `false`. */
  readonly skipReply: boolean | undefined;
  /** Pending parameter slots the binding call marked `stated_elsewhere`. */
  readonly slotCount: number;
  /** Whether the layout stage handed the tree off to the completion call. */
  readonly layoutHandOff: boolean;
}

/**
 * Picks how the final completion call runs. Without `skipReply` it is always
 * `full`. With it, the call is `skip` when no slot or layout tree is left for
 * it to produce, and `replyless` otherwise.
 */
export function completionMode(input: CompletionModeInput): CompletionMode {
  if (input.skipReply !== true) return 'full';
  return input.slotCount === 0 && !input.layoutHandOff ? 'skip' : 'replyless';
}
