import { expect, test } from 'bun:test';
import { assertEvaluationRuntime } from './ci-runtime.js';
import { summarizeJudges } from './judge-result.js';
import type { EvaluationRunAccounting } from './run-orchestration.js';

const accounting: EvaluationRunAccounting = {
  selectedCases: 1,
  plannedSamples: 1,
  completedSamples: 1,
  execution: { completed: 1, error: 0, invalid: 0 },
  evaluation: { pass: 0, fail: 1, unscored: 0, not_applicable: 0 },
  cleanupFailures: 0,
  judge: summarizeJudges([]),
};

test('failed scores and ordinary deferrals remain informational', () => {
  expect(() =>
    assertEvaluationRuntime(accounting, [
      { outcome: 'fail', calls: [{ outcome: 'ok' }] },
      { deferral: { provider: false } },
      { deferral: { provider: true, reason: 'select/provider_refusal' } },
      { outcome: 'deferred', calls: [{ outcome: 'provider_refusal' }] },
      { jevCalls: [{ outcome: 'ok' }, { outcome: 'provider_refusal' }] },
      { outcome: 'not_applicable' },
      { outcome: 'handed_off' },
    ]),
  ).not.toThrow();
});

test('errors, provider deferrals hidden by successful fallback, and failed calls fail CI', () => {
  for (const record of [
    { error: { message: 'failed' } },
    { outcome: 'error' },
    { deferral: { provider: true } },
    ...[
      'provider_http',
      'provider_timeout',
      'provider_invalid_reply',
      'cancelled',
      'option_cap',
      'transport_error',
    ].flatMap((outcome) => [
      { calls: [{ outcome }] },
      { jevCalls: [{ outcome }] },
    ]),
  ])
    expect(() => assertEvaluationRuntime(accounting, [record])).toThrow(
      'runtime failed',
    );
});

test('execution, cleanup and judge infrastructure failures fail CI', () => {
  for (const changed of [
    { execution: { completed: 0, error: 1, invalid: 0 } },
    { execution: { completed: 0, error: 0, invalid: 1 } },
    { cleanupFailures: 1 },
    { judge: { ...accounting.judge, failed: 1 } },
  ])
    expect(() =>
      assertEvaluationRuntime({ ...accounting, ...changed }, []),
    ).toThrow();
});

test('a refusal does not hide an independent transport or execution failure', () => {
  for (const calls of [
    { calls: [{ outcome: 'provider_refusal' }, { outcome: 'provider_http' }] },
    {
      jevCalls: [{ outcome: 'provider_refusal' }, { outcome: 'provider_http' }],
    },
    {
      calls: [{ outcome: 'provider_refusal' }],
      jevCalls: [{ outcome: 'provider_http' }],
    },
    {
      calls: [{ outcome: 'provider_http' }],
      jevCalls: [{ outcome: 'provider_refusal' }],
    },
  ])
    expect(() =>
      assertEvaluationRuntime(accounting, [{ outcome: 'deferred', ...calls }]),
    ).toThrow('runtime failed');
  expect(() =>
    assertEvaluationRuntime(accounting, [
      {
        error: { message: 'fallback failed' },
        deferral: { provider: true, reason: 'select/provider_refusal' },
      },
    ]),
  ).toThrow('runtime failed');
});
