import type {
  RequestOutcome,
  RequestOutcomesState,
  RequestOutcomeView,
} from '@maelstrom-co/client';
import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import { useStore } from '@tanstack/react-store';
import { useEffect } from 'react';

import { nextReceiptOrder } from '../lib/click-receipt';
import { rememberRequestReferences } from './stores/project-tasks.store';
import { summariseReceipt } from './tasklane-activity';

export interface TasklaneRequestReferences {
  /** Remembers the task labels a request's plan was built from, before its Actions run. */
  useRequestReferences: () => void;
  /** Ticket id of the request the receipt line describes, or null before one started. */
  useReceiptRequestId: () => string | null;
  /** Sequence of the request receipt's last change, comparable with a click receipt's order. */
  useRequestReceiptSequence: () => number;
}

/**
 * A planned label goes stale when its task changes after the Planner saw it.
 * Labels are remembered when a request's planned Actions first appear in its
 * outcome, which happens right before they run, so a hand edit made while the
 * Planner worked still makes the label it saw stale.
 */
export const tasklaneRequestReferences: MaelstromExtension<
  TasklaneRequestReferences
> = (ctx: MaelstromExtensionContext) => {
  ctx.onOrchestrator?.((orchestrator) => {
    const outcomes = orchestrator.requestOutcomes.store;
    requestReceiptSequence(outcomes);
    const subscription = outcomes.subscribe(() => {
      requestReceiptSequence(outcomes);
    });
    return () => subscription.unsubscribe();
  });
  return requestReferenceHooks(ctx);
};

/**
 * Sequence of the last change to the request receipt, taken from the counter
 * click receipts use. The store is watched from the moment its Orchestrator
 * exists, so the sequence records when the receipt changed, not when the band
 * rendered it.
 */
export function requestReceiptSequence(
  store: RequestOutcomeView['store'],
): number {
  let clock = receiptClocks.get(store);
  if (!clock) {
    clock = { key: receiptKey(undefined), sequence: 0 };
    receiptClocks.set(store, clock);
  }
  const id = receiptRequestId(store.state);
  const key = receiptKey(id === null ? undefined : store.state.outcomes[id]);
  if (key !== clock.key) {
    clock.key = key;
    clock.sequence = nextReceiptOrder();
  }
  return clock.sequence;
}

const receiptClocks = new WeakMap<
  RequestOutcomeView['store'],
  { key: string; sequence: number }
>();

function requestReferenceHooks(
  ctx: MaelstromExtensionContext,
): TasklaneRequestReferences {
  return {
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
      return useStore(orchestrator.requestOutcomes.store, receiptRequestId);
    },
    useRequestReceiptSequence: () => {
      const { orchestrator } = ctx.useMaelstromContext();
      const outcomes = orchestrator.requestOutcomes.store;
      return useStore(outcomes, () => requestReceiptSequence(outcomes));
    },
  };
}

function receiptRequestId(state: RequestOutcomesState): string | null {
  const ordered = Object.values(state.outcomes);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const status = ordered[index]?.status;
    if (status !== 'queued' && status !== 'not_submitted')
      return ordered[index]?.id ?? null;
  }
  return null;
}

function receiptKey(outcome: RequestOutcome | undefined): string {
  const receipt = summariseReceipt(outcome);
  return `${outcome?.id ?? ''}\u0000${receipt?.text ?? ''}\u0000${receipt?.tone ?? ''}`;
}
