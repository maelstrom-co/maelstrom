import { describe, expect, it } from 'bun:test';

import {
  type ActionExecution,
  ActionName,
  err,
  InstanceId,
  ok,
} from '@maelstrom-co/protocol';

import type { ActionRecord } from '../command-processor/action-runner.types.js';
import { orderActionOutcomes } from './order-action-outcomes.js';

const instanceX = InstanceId('instance-x');
const instanceY = InstanceId('instance-y');

function planStep(instanceId: InstanceId, action: string): ActionExecution {
  return { instanceId, action: ActionName(action) };
}

function successRecord(instanceId: InstanceId, action: string): ActionRecord {
  return {
    instanceId,
    action: ActionName(action),
    result: ok(undefined),
    duration: 1,
  };
}

function failureRecord(
  instanceId: InstanceId,
  action: string,
  message: string,
): ActionRecord {
  return {
    instanceId,
    action: ActionName(action),
    result: err(new Error(message)),
    duration: 1,
  };
}

describe('orderActionOutcomes', () => {
  it('returns no outcomes for an empty plan', () => {
    expect(orderActionOutcomes([], [])).toEqual([]);
  });

  it('keeps record order for a single Instance', () => {
    const outcomes = orderActionOutcomes(
      [planStep(instanceX, 'a1'), planStep(instanceX, 'a2')],
      [successRecord(instanceX, 'a1'), failureRecord(instanceX, 'a2', 'boom')],
    );

    expect(outcomes).toEqual([{ ok: true }, { ok: false, error: 'boom' }]);
  });

  it('restores plan order when Instance groups complete out of order', () => {
    const outcomes = orderActionOutcomes(
      [
        planStep(instanceX, 'a1'),
        planStep(instanceY, 'b1'),
        planStep(instanceX, 'a2'),
      ],
      [
        failureRecord(instanceY, 'b1', 'b1 failed'),
        successRecord(instanceX, 'a1'),
        failureRecord(instanceX, 'a2', 'a2 failed'),
      ],
    );

    expect(outcomes).toEqual([
      { ok: true },
      { ok: false, error: 'b1 failed' },
      { ok: false, error: 'a2 failed' },
    ]);
  });

  it('describes a skip by its reason', () => {
    const outcomes = orderActionOutcomes(
      [planStep(instanceX, 'a1')],
      [
        {
          ...successRecord(instanceX, 'a1'),
          skipped: true,
          errorCategory: 'application',
          reason: 'Variant does not support a1',
        },
      ],
    );

    expect(outcomes).toEqual([
      { ok: false, error: 'skipped: Variant does not support a1' },
    ]);
  });

  it('describes a skip without a reason by its error category', () => {
    const outcomes = orderActionOutcomes(
      [planStep(instanceX, 'a1')],
      [
        {
          ...successRecord(instanceX, 'a1'),
          skipped: true,
          errorCategory: 'readiness',
        },
      ],
    );

    expect(outcomes).toEqual([{ ok: false, error: 'skipped: readiness' }]);
  });

  it('describes a skip with neither reason nor category as unknown', () => {
    const outcomes = orderActionOutcomes(
      [planStep(instanceX, 'a1')],
      [{ ...successRecord(instanceX, 'a1'), skipped: true }],
    );

    expect(outcomes).toEqual([{ ok: false, error: 'skipped: unknown' }]);
  });

  it('reports a planned Action with no record as not run', () => {
    const outcomes = orderActionOutcomes(
      [planStep(instanceX, 'a1'), planStep(instanceY, 'b1')],
      [successRecord(instanceX, 'a1')],
    );

    expect(outcomes).toEqual([
      { ok: true },
      { ok: false, error: 'not run: no result recorded' },
    ]);
  });
});
