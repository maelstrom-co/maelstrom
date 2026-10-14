import { afterEach, describe, expect, test } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';
import { createTelemetry, noopTelemetry } from './telemetry.js';
import type { TelemetryFact, TelemetryRecord, TelemetrySink } from './types.js';

const fact: TelemetryFact = {
  operation: 'client.action',
  outcome: 'succeeded',
  durationMs: 12,
};
let clock: ReturnType<typeof FakeTimers.install> | undefined;
afterEach(() => {
  clock?.uninstall();
  clock = undefined;
});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function turn() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('operational telemetry delivery', () => {
  test('success and startup cannot carry a failure category while skipped readiness remains meaningful', async () => {
    const records: TelemetryRecord[] = [];
    const telemetry = createTelemetry({
      sink: (batch) => {
        records.push(...batch);
      },
    });
    const succeeded = {
      operation: 'client.request',
      outcome: 'succeeded',
      errorCategory: 'timeout',
    } as const;
    const started = {
      operation: 'client.request',
      outcome: 'started',
      errorCategory: 'provider',
    } as const;
    // @ts-expect-error Successful work cannot carry a failure category.
    const invalidSuccess: TelemetryFact = succeeded;
    // @ts-expect-error Starting work does not establish a failure.
    const invalidStart: TelemetryFact = started;
    try {
      telemetry.record(invalidSuccess);
      telemetry.record(invalidStart);
      telemetry.record({
        operation: 'voice.tool',
        outcome: 'skipped',
        errorCategory: 'readiness',
      });
      await telemetry.flush();
      expect(telemetry.getSnapshot().dropped.invalid).toBe(2);
      expect(records.map((record) => record.attributes)).toEqual([
        {
          operation: 'voice.tool',
          outcome: 'skipped',
          errorCategory: 'readiness',
        },
      ]);
    } finally {
      telemetry.dispose();
    }
  });

  test.each([
    'timeout',
    'dispose',
  ] as const)('exporters can distinguish %s aborts', async (reason) => {
    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    let signal: AbortSignal | undefined;
    const pending = deferred();
    const telemetry = createTelemetry({
      exportTimeoutMs: 10,
      sink: (_batch, abort) => {
        signal = abort;
        return pending.promise;
      },
    });
    try {
      telemetry.record(fact);
      await turn();
      if (reason === 'dispose') telemetry.dispose();
      else await clock.tickAsync(10);
      expect(signal?.reason).toMatchObject(
        reason === 'timeout'
          ? {
              name: 'TimeoutError',
              message: 'Telemetry exporter deadline exceeded',
            }
          : { name: 'AbortError', message: 'Telemetry disposed' },
      );
    } finally {
      pending.resolve();
      telemetry.dispose();
    }
  });

  test('omitting the sink allocates no lifetime or timers and never evaluates facts', async () => {
    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const telemetry = createTelemetry();
    expect(telemetry).toBe(noopTelemetry);
    expect(createTelemetry({ capacity: -1 })).toBe(noopTelemetry);
    telemetry.record({
      outcome: 'succeeded',
      get operation(): TelemetryFact['operation'] {
        throw new Error('content canary');
      },
    });
    telemetry.dispose();
    expect(telemetry.getSnapshot()).toEqual({
      state: 'disabled',
      accepted: 0,
      delivered: 0,
      queued: 0,
      exporting: 0,
      dropped: {
        invalid: 0,
        overflow: 0,
        exportError: 0,
        timeout: 0,
        disabled: 0,
        disposed: 0,
      },
    });
    expect((await telemetry.flush()).outcome).toBe('disabled');
    expect(clock.countTimers()).toBe(0);
  });

  test('record returns before invoking the exporter and projects an immutable field allowlist', async () => {
    const batches: (readonly TelemetryRecord[])[] = [];
    const telemetry = createTelemetry({
      sink: (batch) => {
        batches.push(batch);
      },
    });
    const input = {
      ...fact,
      provider: 'livekit' as const,
      requestId: 'CANARY_request',
      sessionId: 'CANARY_session',
      intent: 'CANARY_intent',
      transcript: 'CANARY_transcript',
      arguments: 'CANARY_arguments',
      result: 'CANARY_result',
      error: 'CANARY_error',
      url: 'https://example.com/?key=CANARY_key',
      get readContent() {
        throw new Error('must never inspect content capability');
      },
      get content() {
        throw new Error('must never inspect content');
      },
      get labels() {
        throw new Error('must never enumerate arbitrary labels');
      },
    };
    telemetry.record(input);
    expect(batches).toHaveLength(0);
    Object.assign(input, { outcome: 'failed', durationMs: 999 });
    expect((await telemetry.flush()).outcome).toBe('settled');
    expect(batches).toEqual([
      [
        {
          attributes: {
            operation: 'client.action',
            outcome: 'succeeded',
            provider: 'livekit',
          },
          measurements: [
            {
              type: 'counter',
              name: 'maelstrom.operation.count',
              unit: '{operation}',
              value: 1,
            },
            {
              type: 'histogram',
              name: 'maelstrom.operation.duration',
              unit: 'ms',
              value: 12,
            },
          ],
        },
      ],
    ]);
    expect(JSON.stringify(batches)).not.toContain('CANARY');
    expect(Object.isFrozen(batches[0])).toBe(true);
    expect(Object.isFrozen(batches[0][0].attributes)).toBe(true);
    expect(Object.isFrozen(batches[0][0].measurements)).toBe(true);
    expect(Object.isFrozen(batches[0][0].measurements[1])).toBe(true);
    telemetry.dispose();
  });

  test('unknown timing stays absent while a measured zero is preserved', async () => {
    const records: TelemetryRecord[] = [];
    const telemetry = createTelemetry({
      sink: (batch) => {
        records.push(...batch);
      },
    });
    telemetry.record({ operation: 'voice.tool', outcome: 'cancelled' });
    telemetry.record({ ...fact, durationMs: 0 });
    await telemetry.flush();
    expect(records[0].measurements).toHaveLength(1);
    expect(records[1].measurements[1].value).toBe(0);
    telemetry.dispose();
  });

  test.each([
    { operation: 'CANARY_operation' },
    { outcome: 'CANARY_outcome' },
    { provider: 'CANARY_provider' },
    { errorCategory: 'CANARY_error' },
    { layoutMode: 'CANARY_layout' },
    { durationMs: -1 },
    { durationMs: Infinity },
    { durationMs: NaN },
    { durationMs: '12' },
  ])('rejects unsafe metric dimensions and invalid measurements: %j', async (patch) => {
    let calls = 0;
    const telemetry = createTelemetry({
      sink: () => {
        calls++;
      },
    });
    telemetry.record({ ...fact, ...patch } as TelemetryFact);
    await telemetry.flush();
    expect(calls).toBe(0);
    expect(telemetry.getSnapshot().dropped.invalid).toBe(1);
    telemetry.dispose();
  });

  test('request diversity cannot create new metric labels or suppress aggregate measurements', async () => {
    const records: TelemetryRecord[] = [];
    const telemetry = createTelemetry({
      capacity: 256,
      sink: (batch) => {
        records.push(...batch);
      },
    });
    for (let i = 0; i < 200; i++)
      telemetry.record({
        ...fact,
        requestId: `request-${i}`,
        sampleRate: 0,
      } as TelemetryFact);
    await telemetry.flush();
    expect(records).toHaveLength(200);
    expect(
      new Set(records.map((record) => JSON.stringify(record.attributes))).size,
    ).toBe(1);
    expect(
      records
        .flatMap((record) => record.measurements)
        .filter((measurement) => measurement.type === 'counter')
        .reduce((sum, measurement) => sum + measurement.value, 0),
    ).toBe(200);
    expect(
      records
        .flatMap((record) => record.measurements)
        .filter((measurement) => measurement.type === 'histogram'),
    ).toHaveLength(200);
    telemetry.dispose();
  });

  test('capacity includes the active export and rejects new facts without evicting accepted work', async () => {
    const pending = deferred();
    const batches: (readonly TelemetryRecord[])[] = [];
    const telemetry = createTelemetry({
      capacity: 2,
      batchSize: 1,
      sink: (batch) => {
        batches.push(batch);
        return batches.length === 1 ? pending.promise : undefined;
      },
    });
    telemetry.record(fact);
    await turn();
    telemetry.record({ ...fact, outcome: 'skipped' });
    telemetry.record({ ...fact, outcome: 'failed' });
    expect(telemetry.getSnapshot()).toMatchObject({
      accepted: 2,
      queued: 1,
      exporting: 1,
      dropped: { overflow: 1 },
    });
    pending.resolve();
    await telemetry.flush();
    expect(batches.flat().map((record) => record.attributes.outcome)).toEqual([
      'succeeded',
      'skipped',
    ]);
    telemetry.dispose();
  });

  test.each<['throw' | 'reject' | 'thenable', number]>([
    ['throw', 1],
    ['throw', 3],
    ['reject', 1],
    ['reject', 3],
    ['thenable', 1],
    ['thenable', 3],
  ])('isolates %s exporter failures with batch size %i and counts lost records', async (failure, batchSize) => {
    let calls = 0;
    const sizes: number[] = [];
    const sink: TelemetrySink = (batch) => {
      sizes.push(batch.length);
      if (++calls > 1) return;
      if (failure === 'throw') throw new Error('CANARY_error');
      if (failure === 'reject')
        return Promise.reject(new Error('CANARY_error'));
      return Object.defineProperty({}, 'then', {
        get() {
          throw new Error('CANARY_thenable');
        },
      }) as PromiseLike<void>;
    };
    const telemetry = createTelemetry({ sink, batchSize });
    expect(() => {
      for (let i = 0; i < 5; i++) telemetry.record(fact);
    }).not.toThrow();
    const flush = await telemetry.flush();
    expect(flush.outcome).toBe('settled');
    expect(flush.snapshot).toMatchObject({
      accepted: 5,
      delivered: batchSize === 1 ? 4 : 2,
      dropped: { exportError: batchSize === 1 ? 1 : 3 },
    });
    expect(calls).toBe(batchSize === 1 ? 5 : 2);
    expect(sizes).toEqual(batchSize === 1 ? [1, 1, 1, 1, 1] : [3, 2]);
    telemetry.dispose();
  });

  test('one stalled exporter disables delivery so ignored aborts cannot accumulate unbounded work', async () => {
    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = deferred();
    let calls = 0;
    let signal: AbortSignal | undefined;
    const telemetry = createTelemetry({
      exportTimeoutMs: 20,
      batchSize: 1,
      sink: (_batch, input) => {
        calls++;
        signal = input;
        return pending.promise;
      },
    });
    telemetry.record(fact);
    telemetry.record(fact);
    const flushed = telemetry.flush(100);
    await clock.tickAsync(20);
    expect((await flushed).outcome).toBe('disabled');
    expect(signal?.aborted).toBe(true);
    expect(telemetry.getSnapshot()).toMatchObject({
      state: 'timed_out',
      accepted: 2,
      queued: 0,
      exporting: 0,
      delivered: 0,
      dropped: { timeout: 2 },
    });
    for (let i = 0; i < 100; i++) telemetry.record(fact);
    pending.resolve();
    await clock.tickAsync(100);
    expect(calls).toBe(1);
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.getSnapshot()).toMatchObject({
      delivered: 0,
      dropped: { timeout: 2, disabled: 100 },
    });
    expect(clock.countTimers()).toBe(0);
    telemetry.dispose();
  });

  test('later stalled facts cannot delay a flush started before export scheduling', async () => {
    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const later = deferred();
    const telemetry = createTelemetry({
      sink: (batch) =>
        batch.some((record) => record.attributes.outcome === 'failed')
          ? later.promise
          : undefined,
    });
    try {
      telemetry.record(fact);
      const flushed = telemetry.flush(10);
      telemetry.record({ ...fact, outcome: 'failed' });
      await clock.tickAsync(10);
      const result = await flushed;
      expect(result.outcome).toBe('settled');
      expect(result.snapshot.delivered).toBe(1);
      expect(telemetry.getSnapshot()).toMatchObject({
        state: 'active',
        accepted: 2,
        delivered: 1,
        exporting: 1,
      });
    } finally {
      later.resolve();
      telemetry.dispose();
    }
  });

  test('concurrent flushes each settle their prior work before later stalled facts', async () => {
    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const later = deferred();
    const telemetry = createTelemetry({
      sink: (batch) =>
        batch.some((record) => record.attributes.outcome === 'failed')
          ? later.promise
          : undefined,
    });
    try {
      telemetry.record(fact);
      const first = telemetry.flush(10);
      telemetry.record({ ...fact, outcome: 'skipped' });
      const second = telemetry.flush(10);
      telemetry.record({ ...fact, outcome: 'failed' });
      await clock.tickAsync(10);
      expect(await first).toMatchObject({
        outcome: 'settled',
        snapshot: { delivered: 1 },
      });
      expect(await second).toMatchObject({
        outcome: 'settled',
        snapshot: { delivered: 2 },
      });
    } finally {
      later.resolve();
      telemetry.dispose();
    }
  });

  test('an expired flush cannot block another flush behind an active export', async () => {
    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const active = deferred();
    const later = deferred();
    const telemetry = createTelemetry({
      sink: (batch) => {
        if (batch.some((record) => record.attributes.outcome === 'succeeded'))
          return active.promise;
        if (batch.some((record) => record.attributes.outcome === 'failed'))
          return later.promise;
        return undefined;
      },
    });
    try {
      telemetry.record(fact);
      await turn();
      telemetry.record({ ...fact, outcome: 'skipped' });
      const expired = telemetry.flush(5);
      telemetry.record({ ...fact, outcome: 'cancelled' });
      const healthy = telemetry.flush(20);
      telemetry.record({ ...fact, outcome: 'failed' });
      await clock.tickAsync(5);
      expect((await expired).outcome).toBe('deadline_exceeded');
      active.resolve();
      await clock.tickAsync(15);
      expect(await healthy).toMatchObject({
        outcome: 'settled',
        snapshot: { delivered: 3 },
      });
      expect(telemetry.getSnapshot()).toMatchObject({
        state: 'active',
        delivered: 3,
        exporting: 1,
        dropped: { timeout: 0, exportError: 0 },
      });
    } finally {
      active.resolve();
      later.resolve();
      telemetry.dispose();
    }
  });

  test('flush waits only for prior work while later facts remain queued', async () => {
    const first = deferred();
    const second = deferred();
    let calls = 0;
    const telemetry = createTelemetry({
      batchSize: 1,
      sink: () => (++calls === 1 ? first.promise : second.promise),
    });
    telemetry.record(fact);
    const beforeLaterFact = telemetry.flush();
    telemetry.record(fact);
    first.resolve();
    expect((await beforeLaterFact).snapshot).toMatchObject({
      accepted: 2,
      delivered: 1,
      queued: 1,
    });
    second.resolve();
    expect((await telemetry.flush()).snapshot.delivered).toBe(2);
    telemetry.dispose();
  });

  test('flush deadline stops waiting without dropping or cancelling healthy delivery', async () => {
    clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = deferred();
    const telemetry = createTelemetry({
      exportTimeoutMs: 100,
      sink: () => pending.promise,
    });
    telemetry.record(fact);
    const flushed = telemetry.flush(10);
    await clock.tickAsync(10);
    expect((await flushed).outcome).toBe('deadline_exceeded');
    expect(telemetry.getSnapshot()).toMatchObject({
      state: 'active',
      exporting: 1,
      delivered: 0,
    });
    pending.resolve();
    expect((await telemetry.flush()).snapshot.delivered).toBe(1);
    expect(clock.countTimers()).toBe(0);
    telemetry.dispose();
  });

  test('disposal before export discards the queue without invoking the sink', async () => {
    let calls = 0;
    const telemetry = createTelemetry({
      sink: () => {
        calls++;
      },
    });
    telemetry.record(fact);
    const flushed = telemetry.flush();
    telemetry.dispose();
    telemetry.dispose();
    telemetry.record(fact);
    expect((await flushed).outcome).toBe('disposed');
    await turn();
    expect(calls).toBe(0);
    expect(telemetry.getSnapshot()).toMatchObject({
      state: 'disposed',
      accepted: 1,
      delivered: 0,
      queued: 0,
      exporting: 0,
      dropped: { disposed: 2 },
    });
  });

  test('disposal aborts one export and ignores its late rejection without double counting', async () => {
    const pending = deferred();
    let signal: AbortSignal | undefined;
    const telemetry = createTelemetry({
      batchSize: 1,
      sink: (_batch, input) => {
        signal = input;
        return pending.promise;
      },
    });
    telemetry.record(fact);
    telemetry.record(fact);
    await turn();
    telemetry.dispose();
    pending.reject(new Error('CANARY_late_error'));
    await turn();
    expect(signal?.aborted).toBe(true);
    expect(telemetry.getSnapshot()).toMatchObject({
      delivered: 0,
      dropped: { disposed: 2, exportError: 0 },
    });
  });

  test('reentrant disposal during a fact getter cannot retain work after cleanup', async () => {
    const telemetry = createTelemetry({ sink: () => {} });
    telemetry.record({
      ...fact,
      get provider(): 'custom' {
        telemetry.dispose();
        return 'custom';
      },
    });
    await turn();
    expect(telemetry.getSnapshot()).toMatchObject({
      state: 'disposed',
      accepted: 0,
      queued: 0,
      exporting: 0,
      dropped: { disposed: 1 },
    });
  });

  test('one application exporter failure cannot disable another application', async () => {
    const bad = createTelemetry({
      sink: () => {
        throw new Error('CANARY_failure');
      },
    });
    const good = createTelemetry({ sink: () => {} });
    bad.record(fact);
    good.record(fact);
    await Promise.all([bad.flush(), good.flush()]);
    expect(bad.getSnapshot().dropped.exportError).toBe(1);
    expect(good.getSnapshot()).toMatchObject({
      delivered: 1,
      dropped: { exportError: 0 },
    });
    bad.dispose();
    good.dispose();
  });

  test.each([
    { capacity: 0 },
    { capacity: 65_537 },
    { batchSize: 0 },
    { capacity: 2, batchSize: 3 },
    { exportTimeoutMs: 0 },
    { exportTimeoutMs: 60_001 },
    { capacity: 1.5 },
  ])('rejects configurations that cannot guarantee bounded delivery: %j', (options) => {
    expect(() => createTelemetry({ ...options, sink: () => {} })).toThrow(
      RangeError,
    );
  });
});
