import type {
  ActionExecution,
  AgentActionOutcome,
  InstanceId,
} from '@maelstrom-co/protocol';

import type { ActionRecord } from '../command-processor/action-runner.types.js';

/**
 * Turns the records of an executed Execution Plan into outcomes in plan order.
 * An Action with no record reports as not run, so the result always has one
 * outcome per planned Action.
 */
export function orderActionOutcomes(
  plan: readonly ActionExecution[],
  records: readonly ActionRecord[],
): AgentActionOutcome[] {
  return matchRecordsToPlan(plan, records).map((record) =>
    record === undefined
      ? { ok: false, error: 'not run: no result recorded' }
      : toOutcome(record),
  );
}

/**
 * Pairs each planned Action with its record, in plan order. Records arrive
 * grouped by Instance, so each Action takes the next unclaimed record of its
 * own Instance; an Action with no record pairs with `undefined`.
 */
export function matchRecordsToPlan(
  plan: readonly ActionExecution[],
  records: readonly ActionRecord[],
): (ActionRecord | undefined)[] {
  const recordsByInstance = new Map<InstanceId, ActionRecord[]>();
  for (const record of records) {
    const queue = recordsByInstance.get(record.instanceId);
    if (queue === undefined) {
      recordsByInstance.set(record.instanceId, [record]);
    } else {
      queue.push(record);
    }
  }

  const nextIndexByInstance = new Map<InstanceId, number>();
  return plan.map((step) => {
    const index = nextIndexByInstance.get(step.instanceId) ?? 0;
    nextIndexByInstance.set(step.instanceId, index + 1);
    return recordsByInstance.get(step.instanceId)?.[index];
  });
}

function toOutcome(record: ActionRecord): AgentActionOutcome {
  if (record.skipped === true) {
    const cause = record.reason ?? record.errorCategory ?? 'unknown';
    return { ok: false, error: `skipped: ${cause}` };
  }
  return record.result.ok
    ? { ok: true }
    : { ok: false, error: record.result.error.message };
}
