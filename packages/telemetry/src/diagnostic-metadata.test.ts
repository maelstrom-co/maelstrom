import { expect, test } from 'bun:test';
import { projectDiagnosticMetadata } from './diagnostic-metadata.js';
import { createTelemetry } from './telemetry.js';
import type { TelemetryFact, TelemetryRecord } from './types.js';

test.each<[string, Record<string, unknown>, TelemetryFact]>([
  [
    'client.request.started',
    {},
    { operation: 'client.request', outcome: 'started' },
  ],
  [
    'client.response.received',
    { source: 'request', durationMs: 20 },
    { operation: 'client.request', outcome: 'succeeded', durationMs: 20 },
  ],
  [
    'client.request.failed',
    { durationMs: 12 },
    { operation: 'client.request', outcome: 'failed', durationMs: 12 },
  ],
  [
    'client.response.applied',
    { actionFailures: 0, skippedActions: 0 },
    { operation: 'client.apply', outcome: 'succeeded' },
  ],
  [
    'client.response.applied',
    { actionFailures: 1, skippedActions: 0 },
    { operation: 'client.apply', outcome: 'succeeded_with_issues' },
  ],
  [
    'client.response.applied',
    { actionFailures: 0, skippedActions: 1 },
    { operation: 'client.apply', outcome: 'succeeded_with_issues' },
  ],
  [
    'client.response.failed',
    {},
    { operation: 'client.apply', outcome: 'failed' },
  ],
  [
    'client.response.discarded',
    { reason: 'CANARY_reason' },
    { operation: 'client.apply', outcome: 'discarded' },
  ],
  [
    'client.action.completed',
    { outcome: 'skipped', durationMs: 3 },
    { operation: 'client.action', outcome: 'skipped', durationMs: 3 },
  ],
  [
    'engine.planner.started',
    {},
    { operation: 'engine.plan', outcome: 'started' },
  ],
  [
    'engine.planner.completed',
    { outcome: 'succeeded', durationMs: 50 },
    { operation: 'engine.plan', outcome: 'succeeded', durationMs: 50 },
  ],
  [
    'engine.stage.started',
    {},
    { operation: 'engine.stage', outcome: 'started' },
  ],
  [
    'engine.stage.completed',
    { outcome: 'failed', durationMs: 11 },
    { operation: 'engine.stage', outcome: 'failed', durationMs: 11 },
  ],
  [
    'engine.stage.failed',
    { durationMs: 7 },
    { operation: 'engine.stage', outcome: 'failed', durationMs: 7 },
  ],
  ['voice.tool.called', {}, { operation: 'voice.tool', outcome: 'started' }],
  [
    'voice.tool.result',
    { ok: true, durationMs: 31 },
    { operation: 'voice.tool', outcome: 'succeeded', durationMs: 31 },
  ],
  [
    'voice.tool.result',
    { ok: false, durationMs: 31 },
    { operation: 'voice.tool', outcome: 'unknown', durationMs: 31 },
  ],
  [
    'voice.tool.cancelled',
    {},
    { operation: 'voice.tool', outcome: 'cancelled' },
  ],
])('projects existing producer evidence without changing its meaning: %s', (kind, metadata, expected) => {
  expect(projectDiagnosticMetadata(kind, metadata)).toEqual(expected);
});

test('application completion with missing Action evidence does not invent a clean outcome', () => {
  for (const metadata of [
    {},
    { actionFailures: NaN, skippedActions: 0 },
    { actionFailures: 0, skippedActions: -1 },
    { actionFailures: 0 },
  ]) {
    expect(
      projectDiagnosticMetadata('client.response.applied', metadata),
    ).toEqual({ operation: 'client.apply', outcome: 'unknown' });
  }
});

test('unrelated frames and unsolicited responses cannot inflate request totals', () => {
  for (const kind of [
    'voice.transcript.fragment',
    'voice.observations',
    'voice.provider.arbitrary',
    'client.command.completed',
    'devtools.capture.changed',
    'engine.request.finished',
    'app.event',
  ]) {
    expect(projectDiagnosticMetadata(kind, {})).toBeUndefined();
  }
  expect(
    projectDiagnosticMetadata('client.response.received', { source: 'push' }),
  ).toBeUndefined();
  expect(
    projectDiagnosticMetadata('client.response.received', {}),
  ).toBeUndefined();
});

test('metadata projection never reads content, identifiers, free text, or timestamps', async () => {
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const metadata = { outcome: 'succeeded', durationMs: 9 } as Record<
    string,
    unknown
  >;
  for (const key of [
    'readContent',
    'content',
    'intent',
    'transcript',
    'audio',
    'arguments',
    'result',
    'prompt',
    'provider',
    'stage',
    'error',
    'url',
    'requestId',
    'sessionId',
    'callId',
    'providerInstanceId',
    'generation',
    'providerGeneration',
    'at',
    'serverAt',
    'labels',
    'apiKey',
  ]) {
    Object.defineProperty(metadata, key, {
      enumerable: true,
      get() {
        throw new Error(`CANARY_${key}`);
      },
    });
  }
  const projected = projectDiagnosticMetadata(
    'engine.stage.completed',
    metadata,
    'custom',
  );
  expect(projected).toEqual({
    operation: 'engine.stage',
    outcome: 'succeeded',
    durationMs: 9,
    provider: 'custom',
  });
  if (projected) telemetry.record(projected);
  await telemetry.flush();
  expect(records).toHaveLength(1);
  expect(JSON.stringify(records)).not.toContain('CANARY');
  telemetry.dispose();
});

test.each([
  undefined,
  -1,
  Infinity,
  NaN,
  '12',
])('invalid local duration stays unknown without subtracting process clocks: %j', (durationMs) => {
  expect(
    projectDiagnosticMetadata('voice.tool.result', {
      ok: true,
      durationMs,
      at: 10,
      serverAt: 999,
    }),
  ).toEqual({ operation: 'voice.tool', outcome: 'succeeded' });
});

test.each<[string, Record<string, unknown>, TelemetryFact['operation']]>([
  ['client.action.completed', { outcome: 'CANARY_outcome' }, 'client.action'],
  ['engine.planner.completed', {}, 'engine.plan'],
  ['engine.stage.completed', {}, 'engine.stage'],
  ['voice.tool.result', { ok: 'true' }, 'voice.tool'],
  [
    'voice.tool.result',
    {
      get ok() {
        throw new Error('CANARY_unavailable');
      },
    },
    'voice.tool',
  ],
])('known terminal evidence remains counted when its outcome is unavailable: %s', async (kind, metadata, operation) => {
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  try {
    const fact = projectDiagnosticMetadata(kind, metadata);
    if (fact) telemetry.record(fact);
    await telemetry.flush();
    expect(records.map((record) => record.attributes)).toEqual([
      { operation, outcome: 'unknown' },
    ]);
    expect(JSON.stringify(records)).not.toContain('CANARY');
  } finally {
    telemetry.dispose();
  }
});
