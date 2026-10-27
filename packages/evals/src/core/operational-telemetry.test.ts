import { expect, test } from 'bun:test';
import type { TelemetryFact } from '@maelstrom-co/telemetry';
import { createOperationalCollector } from './operational-telemetry.js';
import {
  unavailableOperationalTelemetry,
  validateOperationalTelemetry,
} from './runtime/operational-telemetry.js';

test('operation/outcome counts and measured durations are independent, finite and content-free', async () => {
  const collector = createOperationalCollector('sample');
  for (const fact of [
    {
      operation: 'engine.request',
      outcome: 'started',
      requestId: 'SECRET ID',
      content: 'SECRET TEXT',
    },
    { operation: 'engine.request', outcome: 'succeeded', durationMs: 0 },
    { operation: 'engine.request', outcome: 'succeeded', durationMs: 20 },
    { operation: 'engine.request', outcome: 'succeeded' },
    { operation: 'engine.stage', outcome: 'succeeded', durationMs: 100 },
  ])
    collector.telemetry.record(fact as TelemetryFact);
  const result = await collector.finalize();
  expect(result.completeness).toBe('complete');
  expect(result.groups).toEqual([
    {
      operation: 'engine.request',
      outcome: 'started',
      count: 1,
      durationSampleCount: 0,
    },
    {
      operation: 'engine.request',
      outcome: 'succeeded',
      count: 3,
      durationSampleCount: 2,
      durationMeanMs: 10,
    },
    {
      operation: 'engine.stage',
      outcome: 'succeeded',
      count: 1,
      durationSampleCount: 1,
      durationMeanMs: 100,
    },
  ]);
  expect(JSON.stringify(result)).not.toContain('SECRET');
  expect(Object.isFrozen(result.groups[0])).toBe(true);
  const bytes = JSON.stringify(result);
  collector.telemetry.record({
    operation: 'engine.request',
    outcome: 'started',
  });
  expect(await collector.finalize()).toBe(result);
  expect(JSON.stringify(result)).toBe(bytes);
});

test('isolated concurrent collectors never use a global current case', async () => {
  const first = createOperationalCollector('sample');
  const second = createOperationalCollector('sample');
  first.telemetry.record({ operation: 'engine.request', outcome: 'started' });
  await Promise.resolve();
  second.telemetry.record({
    operation: 'engine.request',
    outcome: 'failed',
    durationMs: 17,
  });
  first.telemetry.record({
    operation: 'engine.request',
    outcome: 'succeeded',
    durationMs: 2,
  });
  const [a, b] = await Promise.all([first.finalize(), second.finalize()]);
  expect(a.groups.map((group) => group.outcome)).toEqual([
    'started',
    'succeeded',
  ]);
  expect(b.groups.map((group) => group.outcome)).toEqual(['failed']);
});

test('empty collection and unavailable evidence create no invented zero-operation groups', async () => {
  expect(await createOperationalCollector('sample').finalize()).toMatchObject({
    completeness: 'complete',
    groups: [],
  });
  expect(unavailableOperationalTelemetry()).toEqual({
    schemaVersion: 1,
    scope: 'sample',
    completeness: 'unavailable',
    groups: [],
  });
  const run = createOperationalCollector('run');
  run.telemetry.record({ operation: 'engine.plan', outcome: 'cancelled' });
  expect((await run.finalize()).scope).toBe('run');
});

test('overflow, invalid facts and disposed queues expose collection loss rather than clean zeros', async () => {
  const collector = createOperationalCollector('sample', { capacity: 1 });
  collector.telemetry.record({
    operation: 'engine.request',
    outcome: 'started',
  });
  collector.telemetry.record({
    operation: 'engine.request',
    outcome: 'succeeded',
  });
  collector.telemetry.record({
    operation: 'SECRET CUSTOM',
    outcome: 'started',
  } as unknown as TelemetryFact);
  const result = await collector.finalize();
  expect(result.completeness).toBe('partial');
  expect(result.collection?.snapshot.dropped).toMatchObject({
    overflow: 1,
    invalid: 1,
  });
  expect(result.groups).toHaveLength(1);
  const disposed = createOperationalCollector('sample');
  disposed.telemetry.record({ operation: 'engine.plan', outcome: 'started' });
  disposed.telemetry.dispose();
  expect(await disposed.finalize()).toMatchObject({
    completeness: 'partial',
    groups: [],
    collection: {
      flushOutcome: 'disposed',
      snapshot: { dropped: { disposed: 1 } },
    },
  });
});

test('drain precedes flush and failed retirement cannot present complete collection', async () => {
  const collector = createOperationalCollector('sample');
  let resolve!: () => void;
  const drained = new Promise<void>((yes) => {
    resolve = yes;
  });
  const pending = collector.finalize([
    {
      release() {
        queueMicrotask(() => {
          collector.telemetry.record({
            operation: 'engine.request',
            outcome: 'succeeded',
            durationMs: 9,
          });
          resolve();
        });
      },
      drained,
    },
  ]);
  expect((await pending).groups[0]?.durationMeanMs).toBe(9);
  const broken = createOperationalCollector('sample');
  expect(
    await broken.finalize([
      {
        release() {
          throw new Error('private');
        },
        drained: Promise.resolve(),
      },
    ]),
  ).toMatchObject({
    completeness: 'partial',
    collection: { sourceDrained: false },
  });
});

test('stalled source drain is bounded and late callbacks cannot change finalized aggregates', async () => {
  const collector = createOperationalCollector('run');
  let resolve!: () => void;
  const drained = new Promise<void>((yes) => {
    resolve = yes;
  });
  const result = await collector.finalize([{ release() {}, drained }]);
  expect(result.completeness).toBe('partial');
  const bytes = JSON.stringify(result);
  collector.telemetry.record({
    operation: 'engine.request',
    outcome: 'failed',
  });
  resolve();
  await Promise.resolve();
  expect(JSON.stringify(result)).toBe(bytes);
});

test('imported telemetry fails closed for invalid schema, groups, arithmetic and hidden content', async () => {
  const collector = createOperationalCollector('sample');
  collector.telemetry.record({
    operation: 'engine.request',
    outcome: 'succeeded',
    durationMs: 0,
  });
  const valid = await collector.finalize();
  for (const value of [
    { ...valid, schemaVersion: 2 },
    { ...valid, scope: 'guessed' },
    { ...valid, groups: new Array(1) },
    {
      ...valid,
      completeness: 'partial',
      collection: {
        ...valid.collection,
        snapshot: {
          ...valid.collection?.snapshot,
          dropped: { ...valid.collection?.snapshot.dropped, exportError: 1 },
        },
      },
    },
    { ...valid, requestId: 'private' },
    { ...valid, groups: [...valid.groups, ...valid.groups] },
    { ...valid, groups: [{ ...valid.groups[0], operation: 'custom' }] },
    { ...valid, groups: [{ ...valid.groups[0], count: 2 }] },
    { ...valid, groups: [{ ...valid.groups[0], durationMeanMs: NaN }] },
    { ...valid, groups: [{ ...valid.groups[0], durationSampleCount: 2 }] },
    { ...valid, groups: [{ ...valid.groups[0], durationSampleCount: 0 }] },
    { ...valid, completeness: 'unavailable' },
    { ...valid, collection: { ...valid.collection, sourceDrained: false } },
  ])
    expect(() => validateOperationalTelemetry(value)).toThrow(
      'Invalid operational telemetry',
    );
});
