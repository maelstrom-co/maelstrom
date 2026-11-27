import { describe, expect, it } from 'bun:test';

import type { ActionExecution } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

import type { ActionRecord } from '../command-processor/action-runner.types.js';
import type {
  IntentSnapshot,
  IntentSubmission,
} from './intent-scheduler.types.js';
import { RequestOutcomeRecorder } from './request-outcome-recorder.js';
import { REQUEST_OUTCOME_RETENTION } from './request-outcome.types.js';

describe('RequestOutcomeRecorder', () => {
  it('publishes eviction and admission together so a nested admission stays latest', () => {
    const recorder = new RequestOutcomeRecorder();
    for (let index = 0; index < REQUEST_OUTCOME_RETENTION; index += 1)
      recorder.admit(ticket(`t${index}`), `intent ${index}`);

    const observed: string[][] = [];
    let nestedAdmitted = false;
    const subscription = recorder.store.subscribe(() => {
      observed.push(Object.keys(recorder.store.state.outcomes));
      if (nestedAdmitted) return;
      nestedAdmitted = true;
      recorder.admit(ticket('t52'), 'nested');
    });
    recorder.admit(ticket('t51'), 'outer');
    subscription.unsubscribe();

    const { outcomes, latestId } = recorder.store.state;
    expect(latestId).toBe('t52');
    expect(Object.keys(outcomes)).toHaveLength(REQUEST_OUTCOME_RETENTION);
    expect(outcomes['t51']).toBeDefined();
    expect(outcomes['t52']).toBeDefined();
    expect(
      observed.every(
        (ids) =>
          ids.length === REQUEST_OUTCOME_RETENTION || ids.includes('t51'),
      ),
    ).toBe(true);
  });

  it('keeps Actions unknown when records settle after the ticket became unknown', () => {
    const recorder = new RequestOutcomeRecorder();
    const submission = ticket('t1');
    recorder.admit(submission, 'rename the task');
    const store = submission.store as Store<IntentSnapshot>;
    store.setState(() => ({ status: 'processing' }) as IntentSnapshot);
    recorder.planned('t1', [
      { instanceId: 'tasks', action: 'rename', params: {} },
    ] as unknown as ActionExecution[]);
    store.setState(
      () =>
        ({
          status: 'unknown',
          error: new Error('Intent active deadline exceeded'),
        }) as IntentSnapshot,
    );

    recorder.settled('t1', [
      {
        instanceId: 'tasks',
        action: 'rename',
        result: { ok: true, value: 'Renamed' },
        duration: 1,
      },
    ] as unknown as ActionRecord[]);

    const outcome = recorder.store.state.outcomes['t1'];
    expect(outcome?.status).toBe('unknown');
    expect(outcome?.actions.map((action) => action.status)).toEqual([
      'unknown',
    ]);
  });
});

function ticket(id: string): IntentSubmission {
  const snapshot = {
    status: 'queued',
    queuePosition: 1,
  } as unknown as IntentSnapshot;
  return {
    id,
    accepted: true,
    store: new Store(snapshot),
    result: new Promise(() => {}),
  } as unknown as IntentSubmission;
}
