import type { ActionExecution } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

import type { ActionRecord } from '../command-processor/action-runner.types.js';
import type {
  IntentSnapshot,
  IntentSubmission,
} from './intent-scheduler.types.js';
import { matchRecordsToPlan } from './order-action-outcomes.js';
import {
  REQUEST_OUTCOME_RETENTION,
  type RequestActionOutcome,
  type RequestOutcome,
  type RequestOutcomesState,
  type RequestOutcomeView,
} from './request-outcome.types.js';

type Tracked = {
  intent: string;
  snapshot: IntentSnapshot;
  plan: readonly ActionExecution[] | undefined;
  records: readonly ActionRecord[] | undefined;
  release: (() => void) | undefined;
};

/**
 * Builds each request's outcome from its own ticket and its own response batch.
 * Callers report the plan and Action records of the request's execute_actions
 * command only, so unrelated execution never reaches an outcome.
 */
export class RequestOutcomeRecorder implements RequestOutcomeView {
  readonly store = new Store<RequestOutcomesState>({
    outcomes: {},
    latestId: null,
  });
  readonly #tracked = new Map<string, Tracked>();

  admit(ticket: IntentSubmission, intent: string): void {
    const tracked: Tracked = {
      intent,
      snapshot: ticket.store.state,
      plan: undefined,
      records: undefined,
      release: undefined,
    };
    this.#tracked.set(ticket.id, tracked);
    if (!isTerminal(tracked.snapshot)) {
      const subscription = ticket.store.subscribe(() => {
        tracked.snapshot = ticket.store.state;
        if (isTerminal(tracked.snapshot)) this.#release(tracked);
        this.#publish(ticket.id);
      });
      tracked.release = () => subscription.unsubscribe();
    }
    this.#evictOldest();
    this.#publish(ticket.id, ticket.accepted);
  }

  planned(id: string, plan: readonly ActionExecution[]): void {
    const tracked = this.#tracked.get(id);
    if (!tracked) return;
    tracked.plan = plan;
    this.#publish(id);
  }

  settled(id: string, records: readonly ActionRecord[]): void {
    const tracked = this.#tracked.get(id);
    if (!tracked) return;
    tracked.records = records;
    this.#publish(id);
  }

  #publish(id: string, becomesLatest = false): void {
    const tracked = this.#tracked.get(id);
    if (!tracked) return;
    const outcome = toOutcome(id, tracked);
    this.store.setState((state) => ({
      outcomes: { ...state.outcomes, [id]: outcome },
      latestId: becomesLatest ? id : state.latestId,
    }));
  }

  #evictOldest(): void {
    if (this.#tracked.size <= REQUEST_OUTCOME_RETENTION) return;
    const evicted: string[] = [];
    for (const [id, tracked] of this.#tracked) {
      if (this.#tracked.size - evicted.length <= REQUEST_OUTCOME_RETENTION)
        break;
      this.#release(tracked);
      evicted.push(id);
    }
    for (const id of evicted) this.#tracked.delete(id);
    this.store.setState((state) => {
      const outcomes = { ...state.outcomes };
      for (const id of evicted) delete outcomes[id];
      return {
        outcomes,
        latestId:
          state.latestId !== null && evicted.includes(state.latestId)
            ? null
            : state.latestId,
      };
    });
  }

  #release(tracked: Tracked): void {
    tracked.release?.();
    tracked.release = undefined;
  }
}

function isTerminal(snapshot: IntentSnapshot): boolean {
  return snapshot.status !== 'queued' && snapshot.status !== 'processing';
}

function toOutcome(id: string, tracked: Tracked): RequestOutcome {
  const { snapshot, intent } = tracked;
  const actions = toActionOutcomes(tracked);
  switch (snapshot.status) {
    case 'queued':
    case 'processing':
    case 'applied':
      return { id, intent, status: snapshot.status, actions };
    case 'not_submitted':
      return {
        id,
        intent,
        status: snapshot.status,
        actions,
        reason: snapshot.reason,
      };
    case 'failed':
    case 'unknown':
      return {
        id,
        intent,
        status: snapshot.status,
        actions,
        error: snapshot.error,
      };
  }
}

function toActionOutcomes(tracked: Tracked): RequestActionOutcome[] {
  const { plan, records, snapshot } = tracked;
  if (!plan) return [];
  const matched = matchRecordsToPlan(plan, records ?? []);
  return plan.map((step, index) => {
    const target = {
      instanceId: step.instanceId,
      action: step.action,
      ...(step.params === undefined ? {} : { params: step.params }),
    };
    const record = matched[index];
    if (record) return { ...target, ...fromRecord(record) };
    switch (snapshot.status) {
      case 'queued':
      case 'processing':
        return { ...target, status: 'pending' };
      case 'failed':
        return { ...target, status: 'skipped', reason: snapshot.error.message };
      default:
        return { ...target, status: 'unknown' };
    }
  });
}

function fromRecord(
  record: ActionRecord,
):
  | { status: 'ran'; note?: string }
  | { status: 'failed' | 'skipped'; reason: string } {
  if (record.skipped === true)
    return {
      status: 'skipped',
      reason: record.reason ?? record.errorCategory ?? 'skipped',
    };
  if (!record.result.ok)
    return { status: 'failed', reason: record.result.error.message };
  return typeof record.result.value === 'string'
    ? { status: 'ran', note: record.result.value }
    : { status: 'ran' };
}
