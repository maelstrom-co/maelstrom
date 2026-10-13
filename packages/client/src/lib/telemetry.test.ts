import { afterEach, expect, test } from 'bun:test';
import {
  type DiagnosticEvent,
  InstanceId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  createTelemetry,
  type TelemetryOperation,
  type TelemetryOutcome,
  type TelemetryRecord,
} from '@maelstrom-co/telemetry';
import { flushMicrotasks } from '../../test-utils/async-utils.js';
import { createMockConnector } from '../../test-utils/connector-mocks.js';
import {
  createMockEmptyResponse,
  createMockResponse,
} from '../../test-utils/mocks.js';
import type { ActionResult } from './command-processor/action-result.js';
import { WireEngineError } from './connection-manager/connector.types.js';
import { HttpConnector } from './connection-manager/connectors/http-connector.js';
import { DiagnosticChannel } from './diagnostic-channel.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { attachClientTelemetry } from './telemetry.js';

test('client attachment drains only after the last owner releases and leaves delivery application-owned', async () => {
  const client = {
    diagnostics: new DiagnosticChannel(SessionId('attachment-lifetime')),
  };
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const first = attachClientTelemetry(client, telemetry);
  const second = attachClientTelemetry(client, telemetry);
  try {
    expect(first.drained).toBe(second.drained);
    first.release();
    first.release();
    client.diagnostics.emit('client.request.started');
    await telemetry.flush();
    expect(records).toHaveLength(1);
    let drained = false;
    void first.drained.then(() => {
      drained = true;
    });
    await telemetry.flush();
    expect(drained).toBe(false);
    second.release();
    await first.drained;
    client.diagnostics.emit('client.request.started');
    await telemetry.flush();
    expect(records).toHaveLength(1);
    expect(telemetry.enabled).toBe(true);
  } finally {
    first.release();
    second.release();
    telemetry.dispose();
    client.diagnostics.dispose();
  }
});

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test('reentrant diagnostic replacement cannot leave remote forwarding alive for a metadata-only observer', async () => {
  const client = new Orchestrator(createMockConnector());
  const telemetry = createTelemetry({ sink: () => {} });
  const { release: releaseMetadata } = attachClientTelemetry(client, telemetry);
  let first = () => {};
  let replacement = () => {};
  let changed = false;
  first = client.diagnostics.subscribe(({ event }) => {
    if (event.kind !== 'engine.fixture' || changed) return;
    changed = true;
    first();
    replacement = client.diagnostics.subscribe(() => {});
  });
  const remote = new Set<(event: DiagnosticEvent) => void>();
  const connector = Object.assign(createMockConnector(), {
    subscribeDiagnostics(listener: (event: DiagnosticEvent) => void) {
      remote.add(listener);
      listener({
        id: 'initial',
        sessionId: client.getConfig().sessionId,
        kind: 'engine.fixture',
        at: 1,
        metadata: {},
      });
      return () => {
        remote.delete(listener);
      };
    },
    setDiagnosticContent() {},
  });
  cleanups.push(async () => {
    first();
    replacement();
    releaseMetadata();
    telemetry.dispose();
    await client.dispose();
  });
  client.setConnector(connector);
  expect(remote.size).toBe(1);
  replacement();
  expect(remote.size).toBe(0);
  expect(client.diagnostics.observed).toBe(false);
  expect(client.diagnostics.locallyObserved).toBe(true);
  expect(client.diagnostics.diagnosticsObserved).toBe(false);
});

test('retired connector cleanup cannot disable a replacement diagnostic capture', async () => {
  let client!: Orchestrator;
  let replacement = () => {};
  let replace = true;
  let active = 0;
  const content: boolean[] = [];
  const connector = Object.assign(createMockConnector(), {
    subscribeDiagnostics() {
      active++;
      return () => {
        active--;
        if (!replace) return;
        replace = false;
        replacement = client.diagnostics.subscribe(() => {});
      };
    },
    setDiagnosticContent(enabled: boolean) {
      content.push(enabled);
    },
  });
  client = new Orchestrator(connector);
  const telemetry = createTelemetry({ sink: () => {} });
  const { release: releaseMetadata } = attachClientTelemetry(client, telemetry);
  client.diagnostics.emit('devtools.capture.changed', { enabled: true });
  const first = client.diagnostics.subscribe(() => {});
  first();
  expect(active).toBe(1);
  expect(content.at(-1)).toBe(true);
  replacement();
  expect(active).toBe(0);
  expect(content.at(-1)).toBe(false);
  releaseMetadata();
  telemetry.dispose();
  await client.dispose();
});

test('local telemetry preserves atomic settlement without activating remote diagnostics or content', async () => {
  let remoteSubscriptions = 0;
  let contentControls = 0;
  const connector = Object.assign(
    createMockConnector({
      process: async (request) =>
        createMockResponse(request.id, 'CANARY_instance', 'CANARY_action'),
    }),
    {
      subscribeDiagnostics: () => {
        remoteSubscriptions++;
        return () => {};
      },
      setDiagnosticContent: () => {
        contentControls++;
      },
    },
  );
  const client = new Orchestrator(connector, { layoutMode: 'grid' });
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release: first } = attachClientTelemetry(client, telemetry);
  const { release: second } = attachClientTelemetry(client, telemetry);
  cleanups.push(async () => {
    first();
    second();
    telemetry.dispose();
    await client.dispose();
  });
  first();
  first();
  let settle!: (result: ActionResult) => void;
  const action = new Promise<ActionResult>((resolve) => {
    settle = resolve;
  });
  client.commandProcessor.registerRunner(InstanceId('CANARY_instance'), {
    CANARY_action: () => action,
  });
  await client.connect();
  client.chartManager.setDimensions({ columns: 10, rows: 6 });
  const ticket = client.enqueueIntent('CANARY_intent');
  await flushMicrotasks();
  await telemetry.flush();
  expect(
    records.filter(
      (record) =>
        record.attributes.operation === 'client.request' &&
        record.attributes.outcome === 'started',
    ),
  ).toHaveLength(1);
  expect(
    records.some((record) => record.attributes.operation === 'client.apply'),
  ).toBe(false);
  expect(client.intentScheduler.store.state.phase).toBe('applying');
  settle(ok(undefined));
  expect((await ticket.result).status).toBe('applied');
  await telemetry.flush();
  const applied = records.filter(
    (record) => record.attributes.operation === 'client.apply',
  );
  expect(applied).toHaveLength(1);
  expect(applied[0].attributes.outcome).toBe('succeeded');
  expect(
    applied[0].measurements.some(
      (measurement) =>
        measurement.type === 'histogram' && measurement.value >= 0,
    ),
  ).toBe(true);
  expect(JSON.stringify(records)).not.toContain('CANARY');
  expect([remoteSubscriptions, contentControls]).toEqual([0, 0]);
  second();
  expect(client.diagnostics.observed).toBe(false);
  expect(telemetry.enabled).toBe(true);
});

test('omitted or disabled telemetry leaves local observation inactive', async () => {
  const client = new Orchestrator(createMockConnector());
  const { release: absent } = attachClientTelemetry(client);
  const { release: disabled } = attachClientTelemetry(
    client,
    createTelemetry(),
  );
  expect(client.diagnostics.observed).toBe(false);
  absent();
  disabled();
  await client.dispose();
});

test('wire cancellation remains separate from failures without exporting its text', async () => {
  const client = new Orchestrator(
    createMockConnector({
      process: async () => {
        throw new WireEngineError('CANARY_error', 'CancellationError');
      },
    }),
  );
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachClientTelemetry(client, telemetry);
  cleanups.push(async () => {
    release();
    telemetry.dispose();
    await client.dispose();
  });
  await client.connect();
  await client.processIntent('CANARY_intent').catch(() => {});
  await telemetry.flush();
  expect(
    records
      .filter((record) => record.attributes.operation === 'client.request')
      .map((record) => record.attributes.outcome),
  ).toEqual(['started', 'cancelled']);
  expect(JSON.stringify(records)).not.toContain('CANARY');
});

test.each([
  'reject',
  'stall',
] as const)('a %s exporter cannot change a completed client application', async (failure) => {
  const client = new Orchestrator(
    createMockConnector({
      process: async (request) => createMockEmptyResponse(request.id),
    }),
  );
  const telemetry = createTelemetry({
    capacity: 1,
    exportTimeoutMs: 10,
    sink: () =>
      failure === 'stall'
        ? new Promise<void>(() => {})
        : Promise.reject(new Error('CANARY_exporter')),
  });
  const { release } = attachClientTelemetry(client, telemetry);
  cleanups.push(async () => {
    release();
    telemetry.dispose();
    await client.dispose();
  });
  await client.connect();
  expect((await client.enqueueIntent('CANARY_intent').result).status).toBe(
    'applied',
  );
  await telemetry.flush(100);
  expect(telemetry.getSnapshot().dropped.overflow).toBeGreaterThan(0);
  expect(
    failure === 'stall'
      ? telemetry.getSnapshot().dropped.timeout
      : telemetry.getSnapshot().dropped.exportError,
  ).toBeGreaterThan(0);
});

test.each([
  new Error('CANARY_unclassified'),
  new SyntaxError('CANARY_bad_body'),
  Object.assign(new Error('CANARY_arbitrary_abort_name'), {
    name: 'AbortError',
  }),
])('unclassified client errors preserve an unknown cause: %s', async (error) => {
  const client = new Orchestrator(
    createMockConnector({
      process: async () => {
        throw error;
      },
    }),
  );
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachClientTelemetry(client, telemetry);
  try {
    await client.connect();
    await client.processIntent('CANARY_intent').catch(() => {});
    await telemetry.flush();
    expect(
      records
        .filter((r) => r.attributes.outcome === 'failed')
        .map((r) => r.attributes),
    ).toEqual([
      {
        operation: 'client.request',
        outcome: 'failed',
        errorCategory: 'unknown',
      },
    ]);
    expect(JSON.stringify(records)).not.toContain('CANARY');
  } finally {
    release();
    telemetry.dispose();
    await client.dispose();
  }
});

test.each([
  ['timeout', 'timeout'],
  ['transport', 'transport'],
  ['body_transport', 'transport'],
  ['body_timeout', 'timeout'],
  ['aborted', undefined],
  ['invalid_json', 'validation'],
  ['http', 'unknown'],
] as const)('HTTP %s failures use explicit evidence for the operational category', async (mode, category) => {
  const originalFetch = globalThis.fetch;
  const cancellation = new DOMException('CANARY_cancelled', 'AbortError');
  globalThis.fetch = (async (
    _input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
  ) => {
    if (mode === 'aborted') throw cancellation;
    if (mode === 'body_transport')
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('CANARY_body_transport'));
          },
        }),
      );
    if (mode === 'transport') throw new Error('CANARY_network');
    if (mode === 'body_timeout')
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () =>
              controller.error(
                new DOMException('CANARY_body_deadline', 'AbortError'),
              ),
            );
          },
        }),
      );
    if (mode === 'timeout')
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('CANARY_abort', 'AbortError')),
        );
      });
    return new Response('CANARY_not_json', {
      status: mode === 'http' ? 503 : 200,
    });
  }) as typeof globalThis.fetch;
  const client = new Orchestrator(
    new HttpConnector({
      baseUrl: 'https://telemetry-test.invalid',
      timeout: 5,
    }),
  );
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachClientTelemetry(client, telemetry);
  try {
    await client.connect();
    const result = await client
      .processIntent('CANARY_intent')
      .catch((error) => error);
    if (mode === 'aborted') expect(result).toBe(cancellation);
    await telemetry.flush();
    expect(
      records
        .filter(
          (r) =>
            r.attributes.operation === 'client.request' &&
            r.attributes.outcome !== 'started',
        )
        .map((r) => r.attributes),
    ).toEqual([
      category === undefined
        ? { operation: 'client.request', outcome: 'cancelled' }
        : {
            operation: 'client.request',
            outcome: 'failed',
            errorCategory: category,
          },
    ]);
    expect(JSON.stringify(records)).not.toContain('CANARY');
  } finally {
    globalThis.fetch = originalFetch;
    release();
    telemetry.dispose();
    await client.dispose();
  }
});

test.each([
  'disposed',
  'fenced_rejection',
  'fenced_response',
] as const)('request lifecycle reports only work that existed: %s', async (mode) => {
  const pending =
    Promise.withResolvers<ReturnType<typeof createMockEmptyResponse>>();
  const started =
    Promise.withResolvers<Parameters<typeof createMockEmptyResponse>[0]>();
  const client = new Orchestrator(
    createMockConnector({
      process: (request) => {
        started.resolve(request.id);
        return pending.promise;
      },
    }),
  );
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachClientTelemetry(client, telemetry);
  try {
    await client.connect();
    const work = client.processIntent('CANARY_intent').catch(() => {});
    const id = await started.promise;
    if (mode === 'disposed') await client.dispose();
    else client.setConnector(createMockConnector());
    if (mode === 'fenced_rejection')
      pending.reject(new Error('CANARY_retired'));
    else pending.resolve(createMockEmptyResponse(id));
    await work;
    await telemetry.flush();
    const expected: [TelemetryOperation, TelemetryOutcome][] =
      mode === 'disposed'
        ? [
            ['client.request', 'started'],
            ['client.request', 'cancelled'],
          ]
        : mode === 'fenced_rejection'
          ? [
              ['client.request', 'started'],
              ['client.request', 'failed'],
            ]
          : [
              ['client.request', 'started'],
              ['client.request', 'succeeded'],
              ['client.apply', 'discarded'],
            ];
    expect(
      records.map((r) => [r.attributes.operation, r.attributes.outcome]),
    ).toEqual(expected);
  } finally {
    release();
    telemetry.dispose();
    await client.dispose();
  }
});

test.each([
  'connector',
  'source',
] as const)('retained diagnostic listeners cannot publish after %s replacement', async (mode) => {
  const listeners: ((event: DiagnosticEvent) => void)[] = [];
  const connector = () =>
    Object.assign(createMockConnector(), {
      subscribeDiagnostics(listener: (event: DiagnosticEvent) => void) {
        listeners.push(listener);
        return () => {};
      },
    });
  const client = new Orchestrator(connector());
  const telemetry = createTelemetry({ sink: () => {} });
  const { release: releaseMetadata } = attachClientTelemetry(client, telemetry);
  const seen: string[] = [];
  let release = client.diagnostics.subscribe(({ event }) => {
    seen.push(event.kind);
  });
  try {
    expect(listeners).toHaveLength(1);
    if (mode === 'connector') client.setConnector(connector());
    else {
      release();
      release = client.diagnostics.subscribe(({ event }) => {
        seen.push(event.kind);
      });
    }
    expect(listeners).toHaveLength(2);
    const event: DiagnosticEvent = {
      id: 'event',
      sessionId: client.getConfig().sessionId,
      kind: 'engine.stale',
      at: 1,
      metadata: {},
    };
    listeners[0](event);
    listeners[1]({ ...event, kind: 'engine.current' });
    expect(seen).not.toContain('engine.stale');
    expect(seen).toContain('engine.current');
  } finally {
    release();
    releaseMetadata();
    telemetry.dispose();
    await client.dispose();
  }
});

test('a throwing diagnostic subscription reports unavailability while requests remain usable', async () => {
  const client = new Orchestrator(
    Object.assign(
      createMockConnector({
        process: async (request) => createMockEmptyResponse(request.id),
      }),
      {
        subscribeDiagnostics() {
          throw new Error('CANARY_subscription');
        },
      },
    ),
  );
  const telemetry = createTelemetry({ sink: () => {} });
  const { release: releaseMetadata } = attachClientTelemetry(client, telemetry);
  const seen: string[] = [];
  const release = client.diagnostics.subscribe(({ event }) => {
    seen.push(event.kind);
  });
  try {
    expect(
      seen.filter((kind) => kind === 'client.diagnostics.unavailable'),
    ).toHaveLength(1);
    await client.connect();
    expect((await client.enqueueIntent('test').result).status).toBe('applied');
  } finally {
    release();
    releaseMetadata();
    telemetry.dispose();
    await client.dispose();
  }
});

test('a rejected layout counts an application failure after a successful request', async () => {
  const client = new Orchestrator(
    createMockConnector({
      process: async (request) => ({
        ...createMockEmptyResponse(request.id),
        layout: { type: 'invalid' } as unknown as ReturnType<
          typeof createMockEmptyResponse
        >['layout'],
      }),
    }),
  );
  const records: TelemetryRecord[] = [];
  const telemetry = createTelemetry({
    sink: (batch) => {
      records.push(...batch);
    },
  });
  const { release } = attachClientTelemetry(client, telemetry);
  try {
    await client.connect();
    await client.enqueueIntent('test').result;
    await telemetry.flush();
    expect(
      records.map((r) => [r.attributes.operation, r.attributes.outcome]),
    ).toEqual([
      ['client.request', 'started'],
      ['client.request', 'succeeded'],
      ['client.apply', 'failed'],
    ]);
    expect(
      records.some((r) => r.attributes.errorCategory === 'transport'),
    ).toBe(false);
  } finally {
    release();
    telemetry.dispose();
    await client.dispose();
  }
});

test('forwarded Engine diagnostics never enter local metadata subscriptions', async () => {
  let remote!: (event: DiagnosticEvent) => void;
  const client = new Orchestrator(
    Object.assign(createMockConnector(), {
      subscribeDiagnostics(listener: (event: DiagnosticEvent) => void) {
        remote = listener;
        return () => {};
      },
    }),
  );
  const metadata: string[] = [];
  const diagnostics: string[] = [];
  const releaseMetadata = client.diagnostics.subscribeMetadata((kind) => {
    metadata.push(kind);
  });
  const releaseDiagnostics = client.diagnostics.subscribe(({ event }) => {
    diagnostics.push(event.kind);
  });
  try {
    remote({
      id: 'remote',
      sessionId: client.getConfig().sessionId,
      kind: 'engine.stage.completed',
      at: 1,
      metadata: { outcome: 'succeeded' },
    });
    expect(diagnostics).toContain('engine.stage.completed');
    expect(metadata).not.toContain('engine.stage.completed');
    client.diagnostics.emit('client.request.started');
    expect(metadata).toContain('client.request.started');
  } finally {
    releaseDiagnostics();
    releaseMetadata();
    await client.dispose();
  }
});
