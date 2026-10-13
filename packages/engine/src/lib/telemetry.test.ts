import { expect, spyOn, test } from 'bun:test';
import {
  ChartRequestMessage,
  type EngineMessage,
  err,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  createTelemetry,
  type TelemetryOperation,
  type TelemetryRecord,
} from '@maelstrom-co/telemetry';
import {
  buildGridResponse,
  makeGridRequest,
  silentLogger,
} from './__test-helpers__/fixtures.js';
import { createEngine } from './engine.js';
import { cancellationError, providerError, validationError } from './errors.js';
import { createInMemoryStore } from './history/in-memory-store.js';
import { named } from './planner/instrument.js';
import { pipeline } from './planner/pipeline.js';
import type { Planner } from './planner/stage.js';
import { attachEngineTelemetry } from './telemetry.js';

test('Engine attachments share a drain while preserving another owner and application delivery', async () => {
  const engine = createEngine({
    planner: async () => ok(buildGridResponse()),
    retry: false,
    logger: silentLogger,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const first = attachEngineTelemetry(engine, telemetry);
  const second = attachEngineTelemetry(engine, telemetry);
  try {
    expect(first.drained).toBe(second.drained);
    first.release();
    first.release();
    await engine.handle(request());
    await telemetry.flush();
    expect(
      records.filter(
        (record) => record.attributes.operation === 'engine.request',
      ),
    ).toHaveLength(2);
    let drained = false;
    void first.drained.then(() => {
      drained = true;
    });
    await telemetry.flush();
    expect(drained).toBe(false);
    second.release();
    await second.drained;
    const count = records.length;
    await engine.handle(request());
    await telemetry.flush();
    expect(records).toHaveLength(count);
    expect(telemetry.enabled).toBe(true);
  } finally {
    first.release();
    second.release();
    telemetry.dispose();
  }
});

function request() {
  const input = makeGridRequest();
  return ChartRequestMessage({
    id: MessageId('CANARY_request'),
    sessionId: SessionId('CANARY_session'),
    request: {
      ...input,
      context: {
        ...input.context,
        updateReasons: [{ type: 'user_intent', intent: 'CANARY_intent' }],
      },
    },
  });
}

test('refreshing Engine metadata observation cannot duplicate a request or call a removed observer', async () => {
  const engine = createEngine({
    planner: async () => ok(buildGridResponse()),
    retry: false,
    logger: silentLogger,
  });
  const starts: string[] = [];
  let release = () => {};
  let removePending = () => {};
  const observer = (kind: string) => {
    if (kind !== 'engine.request.started') return;
    starts.push(kind);
    removePending();
    if (starts.length < 3) {
      release();
      release = engine.observeMetadata!(observer);
    }
  };
  release = engine.observeMetadata!(observer);
  removePending = engine.observeMetadata!((kind) => {
    if (kind === 'engine.request.started') starts.push('removed observer');
  });
  try {
    expect((await engine.handle(request())).ok).toBe(true);
    expect(starts).toEqual(['engine.request.started']);
    expect((await engine.handle(request())).ok).toBe(true);
    expect(starts).toEqual([
      'engine.request.started',
      'engine.request.started',
    ]);
    release();
    expect((await engine.handle(request())).ok).toBe(true);
    expect(starts).toHaveLength(2);
  } finally {
    release();
    removePending();
  }
});

test('Engine telemetry reports whole requests independently of named nested stages and strips application strings', async () => {
  const planner: Planner = async () => ok(buildGridResponse());
  const engine = createEngine({
    planner: pipeline(named('CANARY_stage', planner)),
    retry: false,
    logger: silentLogger,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release: first } = attachEngineTelemetry(engine, telemetry);
  const { release: second } = attachEngineTelemetry(engine, telemetry);
  first();
  first();
  expect((await engine.handle(request())).ok).toBe(true);
  await telemetry.flush();
  for (const operation of ['engine.request', 'engine.plan', 'engine.stage']) {
    const terminal = records.filter(
      (record) =>
        record.attributes.operation === operation &&
        record.attributes.outcome === 'succeeded',
    );
    expect(terminal).toHaveLength(1);
    expect(
      terminal[0].measurements.some(
        (measurement) =>
          measurement.type === 'histogram' && measurement.value >= 0,
      ),
    ).toBe(true);
  }
  expect(JSON.stringify(records)).not.toContain('CANARY');
  second();
  const count = records.length;
  await engine.handle(request());
  await telemetry.flush();
  expect(records).toHaveLength(count);
  expect(telemetry.enabled).toBe(true);
  telemetry.dispose();
});

test.each([
  'cancelled',
  'failed',
] as const)('Engine %s outcomes retain stable categories across request, planner, and stage', async (outcome) => {
  const planner: Planner = async () =>
    err(
      outcome === 'cancelled'
        ? cancellationError('CANARY_reason', undefined)
        : providerError('CANARY_error', new Error('CANARY_cause')),
    );
  const engine = createEngine({
    planner: pipeline(named('CANARY_stage', planner)),
    retry: false,
    logger: silentLogger,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  expect((await engine.handle(request())).ok).toBe(false);
  await telemetry.flush();
  expect(
    records
      .filter((record) => record.attributes.outcome === outcome)
      .map((record) => record.attributes.operation)
      .sort(),
  ).toEqual(['engine.plan', 'engine.request', 'engine.stage']);
  if (outcome === 'failed')
    expect(
      records
        .filter((record) => record.attributes.outcome === 'failed')
        .every((record) => record.attributes.errorCategory === 'provider'),
    ).toBe(true);
  expect(JSON.stringify(records)).not.toContain('CANARY');
  release();
  telemetry.dispose();
});

test.each([
  'planner',
  'stage',
] as const)('untyped %s errors still count terminal failures without exporting custom details', async (source) => {
  const failure = { _tag: 'CustomError', message: 'CANARY_custom_error' };
  const planner = (async () => err(failure)) as unknown as Planner;
  const engine = createEngine({
    planner:
      source === 'stage' ? pipeline(named('CANARY_stage', planner)) : planner,
    retry: false,
    logger: silentLogger,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  try {
    const handled: unknown = await engine.handle(request());
    expect(handled).toEqual(err(failure));
    await telemetry.flush();
    const operations: TelemetryOperation[] = ['engine.request', 'engine.plan'];
    if (source === 'stage') operations.push('engine.stage');
    for (const operation of operations) {
      expect(
        records.filter(
          (record) =>
            record.attributes.operation === operation &&
            record.attributes.outcome === 'started',
        ),
      ).toHaveLength(1);
      const terminal = records.filter(
        (record) =>
          record.attributes.operation === operation &&
          record.attributes.outcome !== 'started',
      );
      expect(terminal).toHaveLength(1);
      expect(terminal[0].attributes).toEqual({
        operation,
        outcome: 'failed',
        errorCategory: 'unknown',
      });
    }
    expect(JSON.stringify(records)).not.toContain('CANARY');
    expect(JSON.stringify(records)).not.toContain('CustomError');
  } finally {
    release();
    telemetry.dispose();
  }
});

test('idempotent request followers count handled requests while the planner runs only once', async () => {
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let planned = 0;
  const engine = createEngine({
    planner: async () => {
      planned++;
      await pending;
      return ok(buildGridResponse());
    },
    retry: false,
    logger: silentLogger,
    history: { store: createInMemoryStore() },
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  const input = request();
  const first = engine.handle(input);
  const second = engine.handle(input);
  complete();
  expect(
    (await Promise.all([first, second])).every((result) => result.ok),
  ).toBe(true);
  await telemetry.flush();
  expect(planned).toBe(1);
  expect(
    records.filter(
      (record) =>
        record.attributes.operation === 'engine.request' &&
        record.attributes.outcome === 'succeeded',
    ),
  ).toHaveLength(2);
  expect(
    records.filter(
      (record) =>
        record.attributes.operation === 'engine.plan' &&
        record.attributes.outcome === 'succeeded',
    ),
  ).toHaveLength(1);
  release();
  telemetry.dispose();
});

test('rejected Chart payloads count validation failures without planning or exposing diagnostic identities', async () => {
  let now = 10;
  const time = spyOn(performance, 'now').mockImplementation(() => now);
  let planned = 0;
  const engine = createEngine({
    planner: async () => {
      planned++;
      return ok(buildGridResponse());
    },
    retry: false,
    logger: silentLogger,
  });
  const records: TelemetryRecord[] = [];
  const diagnostics: unknown[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  const releaseDiagnostics = engine.observeDiagnostics?.((event) => {
    diagnostics.push(event);
  });
  try {
    const invalid: unknown = {
      ...request(),
      get request() {
        now = 25;
        return { context: { intent: 'CANARY_invalid_payload' } };
      },
    };
    const handled = await engine.handle(invalid as EngineMessage);
    expect(handled).toMatchObject({
      ok: false,
      error: { _tag: 'RequestValidationError' },
    });
    await telemetry.flush();
    expect(records.map((record) => record.attributes)).toEqual([
      { operation: 'engine.request', outcome: 'started' },
      {
        operation: 'engine.request',
        outcome: 'failed',
        errorCategory: 'validation',
      },
    ]);
    expect(records[1].measurements).toEqual([
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
        value: 15,
      },
    ]);
    expect(Number.isFinite(records[1].measurements[1].value)).toBe(true);
    expect(records[1].measurements[1].value).toBeGreaterThanOrEqual(0);
    expect(planned).toBe(0);
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(records)).not.toContain('CANARY');
    expect(JSON.stringify(records)).not.toContain('RequestValidationError');
  } finally {
    release();
    releaseDiagnostics?.();
    telemetry.dispose();
    time.mockRestore();
  }
});

test('rejected non-Chart envelopes do not inflate Chart request failure rates', async () => {
  let planned = 0;
  const engine = createEngine({
    planner: async () => {
      planned++;
      return ok(buildGridResponse());
    },
    retry: false,
    logger: silentLogger,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  try {
    for (const input of [
      null,
      42,
      {},
      { type: 'CANARY_unknown' },
      { ...request(), type: 'assistant_message', content: 42 },
    ]) {
      expect(
        await engine.handle(input as unknown as EngineMessage),
      ).toMatchObject({
        ok: false,
        error: { _tag: 'RequestValidationError' },
      });
    }
    await telemetry.flush();
    expect(records).toEqual([]);
    expect(planned).toBe(0);
  } finally {
    release();
    telemetry.dispose();
  }
});

test('Engine source observation is omitted for disabled telemetry', () => {
  let observed = 0;
  const engine = {
    observeMetadata: () => {
      observed++;
      return () => {};
    },
  };
  attachEngineTelemetry(engine).release();
  attachEngineTelemetry(engine, createTelemetry()).release();
  expect(observed).toBe(0);
});

test.each([
  'planner',
  'stage',
] as const)('unexpected %s throws retain one consistent unknown failure across operation boundaries', async (source) => {
  for (const thrown of [new Error('CANARY_crash'), undefined]) {
    const planner: Planner = async () => {
      throw thrown;
    };
    const engine = createEngine({
      planner:
        source === 'stage' ? pipeline(named('CANARY_stage', planner)) : planner,
      retry: false,
      logger: silentLogger,
    });
    const records: TelemetryRecord[] = [];
    const telemetry = createTelemetry({
      sink: (batch) => {
        records.push(...batch);
      },
    });
    const { release } = attachEngineTelemetry(engine, telemetry);
    try {
      expect(await engine.handle(request())).toMatchObject({
        ok: false,
        error: { _tag: 'ValidationError', field: 'planner' },
      });
      await telemetry.flush();
      const operations: TelemetryOperation[] =
        source === 'stage'
          ? ['engine.request', 'engine.plan', 'engine.stage']
          : ['engine.request', 'engine.plan'];
      for (const operation of operations) {
        expect(
          records
            .filter((r) => r.attributes.operation === operation)
            .map((r) => r.attributes),
        ).toEqual([
          { operation, outcome: 'started' },
          { operation, outcome: 'failed', errorCategory: 'unknown' },
        ]);
      }
      expect(JSON.stringify(records)).not.toContain('CANARY');
    } finally {
      release();
      telemetry.dispose();
    }
  }
});

test('stage-authored instrument names cannot fabricate Engine operational counts', async () => {
  const authored: string[] = [];
  const diagnostics: string[] = [];
  const names = ['stage.completed', 'request.completed', 'planner.started'];
  const engine = createEngine({
    planner: async (_input, ctx) => {
      for (const name of names)
        ctx.instrument.event(name, { outcome: 'failed' });
      return ok(buildGridResponse());
    },
    instrument: {
      event: (name) => {
        authored.push(name);
      },
      stage: (_name, stage) => stage,
    },
    retry: false,
    logger: silentLogger,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  const releaseDiagnostics = engine.observeDiagnostics?.((event) => {
    diagnostics.push(event.kind);
  });
  try {
    expect((await engine.handle(request())).ok).toBe(true);
    await telemetry.flush();
    expect(
      records.map((r) => [r.attributes.operation, r.attributes.outcome]),
    ).toEqual([
      ['engine.request', 'started'],
      ['engine.plan', 'started'],
      ['engine.plan', 'succeeded'],
      ['engine.request', 'succeeded'],
    ]);
    expect(authored).toEqual(names);
    for (const name of names) expect(diagnostics).toContain(`engine.${name}`);
  } finally {
    release();
    releaseDiagnostics?.();
    telemetry.dispose();
  }
});

test.each([
  ['planner', true],
  ['stage', true],
  ['request', false],
  ['request', true],
] as const)('%s exception observation respects aborted=%s and terminal cardinality', async (source, aborted) => {
  const controller = new AbortController();
  const failure = new Error('CANARY_exception');
  const crash = () => {
    if (aborted) controller.abort('CANARY_abort');
    throw failure;
  };
  const planner: Planner = async () => crash();
  const engine = createEngine({
    planner:
      source === 'stage' ? pipeline(named('CANARY_stage', planner)) : planner,
    logger:
      source === 'request' ? { ...silentLogger, debug: crash } : silentLogger,
    retry: false,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  try {
    if (source === 'request')
      await expect(engine.handle(request(), controller.signal)).rejects.toBe(
        failure,
      );
    else
      expect(await engine.handle(request(), controller.signal)).toMatchObject({
        ok: false,
        error: { _tag: 'CancellationError' },
      });
    await telemetry.flush();
    const operations: TelemetryOperation[] =
      source === 'request'
        ? ['engine.request']
        : source === 'stage'
          ? ['engine.request', 'engine.plan', 'engine.stage']
          : ['engine.request', 'engine.plan'];
    for (const operation of operations) {
      expect(
        records
          .filter((r) => r.attributes.operation === operation)
          .map((r) => r.attributes),
      ).toEqual([
        { operation, outcome: 'started' },
        aborted
          ? { operation, outcome: 'cancelled' }
          : { operation, outcome: 'failed', errorCategory: 'unknown' },
      ]);
    }
    expect(JSON.stringify(records)).not.toContain('CANARY');
  } finally {
    release();
    telemetry.dispose();
  }
});

test('genuine planner validation failures keep their category even with a cause', async () => {
  const failure = validationError(
    'CANARY_validation',
    'planner',
    new Error('CANARY_cause'),
  );
  const engine = createEngine({
    planner: async () => err(failure),
    logger: silentLogger,
    retry: false,
  });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachEngineTelemetry(engine, telemetry);
  try {
    expect(await engine.handle(request())).toEqual(err(failure));
    await telemetry.flush();
    expect(
      records
        .filter((r) => r.attributes.outcome === 'failed')
        .map((r) => r.attributes.errorCategory),
    ).toEqual(['validation', 'validation']);
  } finally {
    release();
    telemetry.dispose();
  }
});
