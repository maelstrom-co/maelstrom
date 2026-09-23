import type { CancellationError, ProviderError } from '@maelstrom-co/engine';
import {
  err,
  isErr,
  type Result,
  type TilingNode,
} from '@maelstrom-co/protocol';

import type { Completion } from '../completion-schema.js';
import { outputSchema } from '../completion-schema.js';
import {
  assembleCandidate,
  buildMessagePrompt,
  callLlm,
  layoutLabel,
  prepareCompletion,
} from './complete-layout-inline.js';
import type { CompletionLlm } from './deps.js';
import { llmLayoutCall } from './llm-layout-call.js';
import type { CompleteStage } from './types.js';

/** What the decisions section says under "Layout:" while the layout call is still in flight. */
const PARALLEL_HAND_OFF_LABEL = 'written by a separate call this turn';

/**
 * `completeLayoutInline`'s companion: on a hand-off, runs the message-only
 * completion call and a small dedicated layout call ({@link llmLayoutCall})
 * in parallel instead of one call that writes both, so neither piece of
 * work waits on the other. When either call fails the other is aborted
 * and the first failure is returned. A decision that already carries a tree runs
 * exactly the message call `completeLayoutInline` would.
 */
export function completeLayoutParallel(llm: CompletionLlm): CompleteStage {
  return async (decision, ctx) => {
    const prep = prepareCompletion(decision);
    const { slots, visible, handOff } = prep;
    const { history } = decision.plan.selection.input;

    if (!handOff) {
      const completion = await callLlm<Completion>(
        llm,
        buildMessagePrompt(decision, slots, layoutLabel(decision)),
        outputSchema(slots),
        history,
        ctx,
      );
      if (isErr(completion)) return completion;
      return assembleCandidate(
        ctx,
        decision,
        completion.value,
        prep,
        decision.tree,
      );
    }

    const siblings = new AbortController();
    const callCtx = {
      ...ctx,
      signal: ctx.signal
        ? AbortSignal.any([ctx.signal, siblings.signal])
        : siblings.signal,
    };
    let firstFailure: CancellationError | ProviderError | undefined;
    const abortSiblingOnFailure = <T>(
      result: Result<T, CancellationError | ProviderError>,
    ) => {
      if (isErr(result) && firstFailure === undefined) {
        firstFailure = result.error;
        siblings.abort(result.error);
      }
      return result;
    };
    const [messageResult, layoutResult] = await Promise.all([
      callLlm<Completion>(
        llm,
        buildMessagePrompt(decision, slots, PARALLEL_HAND_OFF_LABEL),
        outputSchema(slots),
        history,
        callCtx,
      ).then(abortSiblingOnFailure),
      llmLayoutCall(llm, decision, visible, callCtx).then(
        abortSiblingOnFailure,
      ),
    ]);
    if (firstFailure !== undefined) return err(firstFailure);
    if (isErr(messageResult)) return messageResult;
    if (isErr(layoutResult)) return layoutResult;
    return assembleCandidate(
      ctx,
      decision,
      messageResult.value,
      prep,
      layoutResult.value.tree as readonly TilingNode[] | undefined,
    );
  };
}
