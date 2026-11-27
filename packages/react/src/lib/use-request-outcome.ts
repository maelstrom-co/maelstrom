import type { IntentSubmission, RequestOutcome } from '@maelstrom-co/client';
import { useStore } from '@tanstack/react-store';

import type { MaelstromContextPair } from './context.js';

/**
 * Creates the `m.useRequestOutcome()` hook. It re-renders the component when
 * the outcome of the given request changes.
 */
export function createUseRequestOutcome(contextPair: MaelstromContextPair) {
  const { useMaelstromContext } = contextPair;

  return function useRequestOutcome(
    ticket: IntentSubmission | string | null | undefined,
  ): RequestOutcome | undefined {
    const { orchestrator } = useMaelstromContext();
    const id = typeof ticket === 'string' ? ticket : ticket?.id;
    return useStore(orchestrator.requestOutcomes.store, (state) =>
      id === undefined ? undefined : state.outcomes[id],
    );
  };
}

/**
 * Creates the `m.useLatestRequestOutcome()` hook. It re-renders the component
 * when the most recently admitted request or its outcome changes.
 */
export function createUseLatestRequestOutcome(
  contextPair: MaelstromContextPair,
) {
  const { useMaelstromContext } = contextPair;

  return function useLatestRequestOutcome(): RequestOutcome | undefined {
    const { orchestrator } = useMaelstromContext();
    return useStore(orchestrator.requestOutcomes.store, (state) =>
      state.latestId === null ? undefined : state.outcomes[state.latestId],
    );
  };
}
