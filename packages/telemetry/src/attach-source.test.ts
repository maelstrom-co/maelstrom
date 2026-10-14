import { expect, test } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';
import { attachTelemetrySource } from './attach-source.js';
import { createTelemetry } from './telemetry.js';

test('an attached producer counts refused facts after delivery is disposed', () => {
  const telemetry = createTelemetry({ sink: () => {} });
  let observe!: Parameters<Parameters<typeof attachTelemetrySource>[3]>[0];
  let releases = 0;
  const release = attachTelemetrySource({}, telemetry, 'client', (observer) => {
    observe = observer;
    return () => {
      releases++;
    };
  });
  try {
    telemetry.dispose();
    observe('client.request.started', {});
    expect(telemetry.getSnapshot().dropped.disposed).toBe(1);
    expect(releases).toBe(0);
  } finally {
    release.release();
  }
  expect(releases).toBe(1);
});

test.each([
  'start',
  'release',
  'rejected-release',
] as const)('a failed %s reports source loss and fences leaked callbacks', async (mode) => {
  const records: import('./types.js').TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const owner = {};
  let stale!: Parameters<Parameters<typeof attachTelemetrySource>[3]>[0];
  const release = attachTelemetrySource(
    owner,
    telemetry,
    'client',
    (observer) => {
      stale = observer;
      if (mode === 'start') throw new Error('CANARY_start');
      return () => {
        if (mode === 'release') throw new Error('CANARY_release');
        return Promise.reject(new Error('CANARY_rejected_release'));
      };
    },
  );
  release.release();
  await Promise.resolve();
  await Promise.resolve();
  stale('client.request.started', {});
  const replacement = attachTelemetrySource(
    owner,
    telemetry,
    'client',
    (observer) => {
      observer('client.request.started', {});
      return () => {};
    },
  );
  try {
    await telemetry.flush();
    expect(records.map((record) => record.attributes)).toEqual([
      { operation: 'telemetry.source', outcome: 'discarded' },
      { operation: 'client.request', outcome: 'started' },
    ]);
    expect(JSON.stringify(records)).not.toContain('CANARY');
  } finally {
    replacement.release();
    telemetry.dispose();
  }
});

test('shared retirement completes only after the final release and accepted source work', async () => {
  const telemetry = createTelemetry({ sink: () => {} });
  const pending = Promise.withResolvers<void>();
  let subscriptions = 0;
  let releases = 0;
  const owner = {};
  const start = () => {
    subscriptions++;
    return () => {
      releases++;
      return pending.promise;
    };
  };
  const first = attachTelemetrySource(owner, telemetry, 'voice', start);
  const second = attachTelemetrySource(owner, telemetry, 'voice', start);
  try {
    expect(first).toHaveProperty('drained');
    expect(first.drained).toBe(second.drained);
    let drained = false;
    void first.drained.then(() => {
      drained = true;
    });
    first.release();
    first.release();
    await Promise.resolve();
    expect(subscriptions).toBe(1);
    expect(releases).toBe(0);
    expect(drained).toBe(false);
    second.release();
    await Promise.resolve();
    expect(releases).toBe(1);
    expect(drained).toBe(false);
    pending.resolve();
    await first.drained;
    expect(drained).toBe(true);
  } finally {
    pending.resolve();
    telemetry.dispose();
  }
});

test('attachment policies reject incompatible sharing and release permits a fresh subscription', async () => {
  const telemetry = createTelemetry({ sink: () => {} });
  const owner = {};
  let starts = 0;
  let stops = 0;
  const start = () => {
    starts++;
    return () => {
      stops++;
    };
  };
  const first = attachTelemetrySource(
    owner,
    telemetry,
    'client',
    start,
    'custom',
    'original',
  );
  try {
    expect(() =>
      attachTelemetrySource(
        owner,
        telemetry,
        'engine',
        start,
        'custom',
        'original',
      ),
    ).toThrow(RangeError);
    expect(() =>
      attachTelemetrySource(
        owner,
        telemetry,
        'client',
        start,
        'livekit',
        'original',
      ),
    ).toThrow(RangeError);
    expect(() =>
      attachTelemetrySource(
        owner,
        telemetry,
        'client',
        start,
        'custom',
        'changed',
      ),
    ).toThrow(RangeError);
    expect(starts).toBe(1);
    first.release();
    first.release();
    await first.drained;
    expect(stops).toBe(1);
    const fresh = attachTelemetrySource(owner, telemetry, 'engine', start);
    expect(starts).toBe(2);
    fresh.release();
    await fresh.drained;
    expect(stops).toBe(2);
  } finally {
    first.release();
    telemetry.dispose();
  }
});

test('owners and delivery instances retain independent subscriptions', async () => {
  const a = createTelemetry({ sink: () => {} });
  const b = createTelemetry({ sink: () => {} });
  const owner = {};
  let active = 0;
  const start = () => {
    active++;
    return () => {
      active--;
    };
  };
  const first = attachTelemetrySource(owner, a, 'client', start);
  const duplicate = attachTelemetrySource(owner, a, 'client', start);
  const otherOwner = attachTelemetrySource({}, a, 'client', start);
  const otherTelemetry = attachTelemetrySource(owner, b, 'client', start);
  try {
    expect(active).toBe(3);
    first.release();
    expect(active).toBe(3);
    duplicate.release();
    expect(active).toBe(2);
    otherOwner.release();
    expect(active).toBe(1);
    otherTelemetry.release();
    expect(active).toBe(0);
    await Promise.all([
      first.drained,
      otherOwner.drained,
      otherTelemetry.drained,
    ]);
  } finally {
    first.release();
    duplicate.release();
    otherOwner.release();
    otherTelemetry.release();
    a.dispose();
    b.dispose();
  }
});

test('exporter timeout keeps attached producer refusals visible until explicit release', async () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  const pending = Promise.withResolvers<void>();
  const telemetry = createTelemetry({
    sink: () => pending.promise,
    exportTimeoutMs: 10,
  });
  let observe!: Parameters<Parameters<typeof attachTelemetrySource>[3]>[0];
  const handle = attachTelemetrySource({}, telemetry, 'engine', (observer) => {
    observe = observer;
    return () => {};
  });
  try {
    observe('engine.request.started', {});
    await clock.tickAsync(10);
    observe('engine.request.completed', { outcome: 'failed' });
    expect(telemetry.getSnapshot()).toMatchObject({
      state: 'timed_out',
      dropped: { timeout: 1, disabled: 1 },
    });
    handle.release();
    observe('engine.request.started', {});
    expect(telemetry.getSnapshot().dropped.disabled).toBe(1);
  } finally {
    pending.resolve();
    handle.release();
    telemetry.dispose();
    clock.uninstall();
  }
});
