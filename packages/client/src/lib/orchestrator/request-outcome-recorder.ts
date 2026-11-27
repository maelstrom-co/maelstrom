import type { ActionExecution } from '@maelstrom-co/protocol';

import type { ActionRecord } from '../command-processor/action-runner.types.js';
import type { Logger } from '../utils/logger.js';
import { GuardedStore } from './guarded-store.js';
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
 * command only, so unrelated execution never reaches an outcome. A store
 * subscriber that throws is reported to the logger and never reaches
 * admission or scheduling.
 */
export class RequestOutcomeRecorder implements RequestOutcomeView {
  readonly store: GuardedStore<RequestOutcomesState>;
  readonly #tracked = new Map<string, Tracked>();
  readonly #logger: Pick<Logger, 'error'>;

  constructor(logger: Pick<Logger, 'error'>) {
    this.#logger = logger;
    this.store = new GuardedStore<RequestOutcomesState>(
      { outcomes: {}, latestId: null },
      (error) => this.#reportSubscriberError(error),
    );
  }

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
    const evicted = this.#evictOldest();
    this.#publish(ticket.id, ticket.accepted, evicted);
  }

  planned(id: string, plan: readonly ActionExecution[]): void {
    const tracked = this.#tracked.get(id);
    if (!tracked || isTerminal(tracked.snapshot)) return;
    tracked.plan = plan;
    this.#publish(id);
  }

  // A ticket can turn terminal (an active deadline reports unknown) while its
  // batch keeps running. Its outcome is final once the caller can read it.
  settled(id: string, records: readonly ActionRecord[]): void {
    const tracked = this.#tracked.get(id);
    if (!tracked || isTerminal(tracked.snapshot)) return;
    tracked.records = records;
    this.#publish(id);
  }

  #publish(
    id: string,
    becomesLatest = false,
    evicted: readonly string[] = [],
  ): void {
    const tracked = this.#tracked.get(id);
    if (!tracked) return;
    const outcome = toOutcome(id, tracked);
    // Subscribers are guarded one by one. This catch is the fallback for a
    // throw the store raises itself, which arrives after the state is applied.
    try {
      this.store.setState((state) => {
        const outcomes = { ...state.outcomes };
        for (const evictedId of evicted) delete outcomes[evictedId];
        outcomes[id] = outcome;
        const previous =
          state.latestId !== null && evicted.includes(state.latestId)
            ? null
            : state.latestId;
        return { outcomes, latestId: becomesLatest ? id : previous };
      });
    } catch (error) {
      this.#reportSubscriberError(error);
    }
  }

  #reportSubscriberError(error: unknown): void {
    this.#logger.error('Request outcome store subscriber threw', error);
  }

  #evictOldest(): string[] {
    const evicted: string[] = [];
    if (this.#tracked.size <= REQUEST_OUTCOME_RETENTION) return evicted;
    for (const [id, tracked] of this.#tracked) {
      if (this.#tracked.size - evicted.length <= REQUEST_OUTCOME_RETENTION)
        break;
      this.#release(tracked);
      evicted.push(id);
    }
    for (const id of evicted) this.#tracked.delete(id);
    return evicted;
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
  | { status: 'ran'; value?: unknown }
  | { status: 'failed' | 'skipped'; reason: string } {
  if (record.skipped === true)
    return {
      status: 'skipped',
      reason: record.reason ?? record.errorCategory ?? 'skipped',
    };
  if (!record.result.ok)
    return { status: 'failed', reason: record.result.error.message };
  return record.result.value === undefined
    ? { status: 'ran' }
    : { status: 'ran', value: record.result.value };
}
