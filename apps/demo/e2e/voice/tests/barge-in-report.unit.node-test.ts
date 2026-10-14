import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type BargeInMeasurement,
  invalidBargeIn,
} from './barge-in-measurement.ts';
import { assessBargeInRun, completeBargeInReport } from './barge-in-report.ts';

const measured: BargeInMeasurement = {
  status: 'measured',
  humanOnsetSample: 100,
  assistantStopSample: 200,
  latencyMs: 100,
  reason: null,
};

test('a report passes only when every expected attempt has measured latency', () => {
  assert.equal(assessBargeInRun([measured], 1).status, 'passed');
  for (const status of ['invalid', 'ambiguous', 'timeout', 'failed'] as const) {
    const result = assessBargeInRun(
      [{ ...measured, status, latencyMs: null, reason: 'sample reason' }],
      1,
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.failedAttemptCount, 1);
    assert.ok(result.reasons.some((reason) => reason.includes(status)));
  }
  assert.equal(assessBargeInRun([], 1).status, 'failed');
  assert.equal(assessBargeInRun([], 0).status, 'failed');
  assert.equal(
    assessBargeInRun([measured, invalidBargeIn('unusable')], 3)
      .failedAttemptCount,
    2,
  );
  for (const latencyMs of [null, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.equal(
      assessBargeInRun([{ ...measured, latencyMs }], 1).status,
      'failed',
    );
});

test('the invalid report is attached before its test fails', async () => {
  const events: string[] = [];
  const assessment = assessBargeInRun(
    [invalidBargeIn('No overlap', 253_440)],
    1,
  );
  const report = {
    status: assessment.status,
    measurements: [invalidBargeIn('No overlap', 253_440)],
  };
  await assert.rejects(
    completeBargeInReport(report, assessment, async (value) => {
      events.push('attached');
      assert.equal(value.status, 'failed');
      assert.equal(value.measurements[0]?.humanOnsetSample, 253_440);
    }),
    /non-measured.*invalid.*No overlap/,
  );
  events.push('failed');
  assert.deepEqual(events, ['attached', 'failed']);
});

test('infrastructure failure is preserved after diagnostic attachment', async () => {
  const original = new Error('capture unavailable');
  let attached = false;
  await assert.rejects(
    completeBargeInReport(
      {},
      assessBargeInRun([], 1),
      async () => {
        attached = true;
      },
      original,
    ),
    (error) => error === original,
  );
  assert.equal(attached, true);
});
