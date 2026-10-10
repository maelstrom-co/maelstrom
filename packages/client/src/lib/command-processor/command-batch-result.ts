/** Outcome of one atomic command batch, independent of other queued commands. */
export type CommandBatchResult =
  | {
      /** Every command and action completed successfully. */
      readonly status: 'applied';
    }
  | {
      /** `failed` is a first-layout refusal; partial, skipped or disposed work is `unknown`. */
      readonly status: 'failed' | 'unknown';
      /** Original refusal or execution error, when available. */
      readonly error: Error;
    };
