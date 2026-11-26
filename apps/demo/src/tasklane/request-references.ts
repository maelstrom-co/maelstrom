import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import { useStore } from '@tanstack/react-store';
import { useEffect } from 'react';

import { rememberRequestReferences } from './stores/project-tasks.store';

export interface TasklaneRequestReferences {
  /** Remembers the task labels a request's plan was built from, before its Actions run. */
  useRequestReferences: () => void;
  /** Ticket id of the request the receipt line describes, or null before one started. */
  useReceiptRequestId: () => string | null;
}

/**
 * A planned label goes stale when its task changes after the Planner saw it.
 * Labels are remembered when a request's planned Actions first appear in its
 * outcome, which happens right before they run, so a hand edit made while the
 * Planner worked still makes the label it saw stale.
 */
export const tasklaneRequestReferences: MaelstromExtension<
  TasklaneRequestReferences
> = (ctx: MaelstromExtensionContext) => ({
  useRequestReferences: () => {
    const { orchestrator } = ctx.useMaelstromContext();
    useEffect(() => {
      const outcomes = orchestrator.requestOutcomes.store;
      const remembered = new Set(Object.keys(outcomes.state.outcomes));
      const subscription = outcomes.subscribe(() => {
        for (const outcome of Object.values(outcomes.state.outcomes)) {
          if (outcome.actions.length === 0 || remembered.has(outcome.id))
            continue;
          remembered.add(outcome.id);
          rememberRequestReferences();
        }
      });
      return () => subscription.unsubscribe();
    }, [orchestrator]);
  },
  // Outcomes are keyed in admission order and run one at a time, so the last
  // one that started is the running request or the most recently settled one,
  // even while a later request waits in the queue.
  useReceiptRequestId: () => {
    const { orchestrator } = ctx.useMaelstromContext();
    return useStore(orchestrator.requestOutcomes.store, (state) => {
      const ordered = Object.values(state.outcomes);
      for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const status = ordered[index]?.status;
        if (status !== 'queued' && status !== 'not_submitted')
          return ordered[index]?.id ?? null;
      }
      return null;
    });
  },
});
