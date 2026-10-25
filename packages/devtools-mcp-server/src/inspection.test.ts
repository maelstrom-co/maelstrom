import { afterAll, afterEach, expect, spyOn, test } from 'bun:test';
// biome-ignore lint/style/noRestrictedImports: Integration tests compose browser and server packages outside the published runtime.
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
// biome-ignore lint/style/noRestrictedImports: Integration tests compose browser and server packages outside the published runtime.
import { createDevtools, type DevtoolsOptions } from '@maelstrom-co/devtools';
// biome-ignore lint/style/noRestrictedImports: Integration tests compose browser and server packages outside the published runtime.
import { connectDevtoolsBridge } from '@maelstrom-co/devtools/mcp-bridge';
import {
  MAX_BRIDGE_BYTES,
  ReadResultSchema,
} from '@maelstrom-co/devtools-protocol';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createDevtoolsMcpServer } from './index.js';

function app() {
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    process: async () => {
      throw new Error('No Engine calls in metadata tests.');
    },
    addAssistantMessage: async () => {},
    getHistory: async () => [],
  };
  const client = new Orchestrator(connector);
  releases.push(() => client.dispose());
  return client;
}

const releases: (() => void | Promise<void>)[] = [];
const NativeWebSocket = globalThis.WebSocket as typeof globalThis.WebSocket &
  (new (
    url: string | URL,
    options: { headers: Record<string, string> },
  ) => WebSocket);
let browserOrigin = 'http://localhost:4321';
globalThis.WebSocket = class extends NativeWebSocket {
  constructor(url: string | URL) {
    super(url, { headers: { Origin: browserOrigin } });
  }
};
afterAll(() => {
  globalThis.WebSocket = NativeWebSocket;
});
afterEach(async () => {
  browserOrigin = 'http://localhost:4321';
  for (const release of releases.splice(0).reverse()) await release();
});

async function setup(
  options: DevtoolsOptions = {},
  protocol: 'legacy' | '2026-07-28' = 'legacy',
) {
  const host = await createDevtoolsMcpServer({
    origin: 'http://localhost:4321',
  });
  releases.push(() => host.close());
  const tools = createDevtools(options);
  releases.push(() => tools.dispose());
  const disconnect = await connectDevtoolsBridge(tools, {
    endpoint: host.endpoint,
    token: host.pairingToken,
  });
  releases.push(disconnect);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = serveStdio(() => host.createServer(), { transport: a });
  const client = new Client(
    { name: 'inspection-test', version: '1' },
    {
      versionNegotiation: {
        mode: protocol === 'legacy' ? 'legacy' : { pin: protocol },
      },
    },
  );
  releases.push(
    () => client.close(),
    () => server.close(),
  );
  await client.connect(b);
  if (protocol !== 'legacy')
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
  const result = await client.callTool({ name: 'list_targets', arguments: {} });
  const targetId = (result.structuredContent as { targets: { id: string }[] })
    .targets[0].id;
  return { tools, host, client, targetId, disconnect };
}

async function listedApps(client: Client, targetId: string) {
  const listed = ReadResultSchema.parse(
    (await client.callTool({ name: 'list_apps', arguments: { targetId } }))
      .structuredContent,
  );
  if (!listed.ok || listed.data.kind !== 'apps')
    throw new Error('Expected apps.');
  return listed.data.apps;
}

function recoveryText(result: Awaited<ReturnType<Client['callTool']>>) {
  const block = result.content[1];
  if (block?.type !== 'text') throw new Error('Expected recovery guidance.');
  return block.text;
}

test('large event pages bound encoding work and preserve every event across cursors', async () => {
  const { tools, client, targetId } = await setup();
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  for (let order = 0; order < 100; order++) {
    first.diagnostics.emitDiagnostic('app.sample', {
      order,
      ...(order < 3
        ? Object.fromEntries(
            Array.from({ length: 15 }, (_, index) => [
              `field${index}`,
              'a'.repeat(16_000),
            ]),
          )
        : {}),
    });
  }
  const args = { targetId, appId, view: 'recent', limit: 100 };
  const stringify = JSON.stringify;
  let encodedBytes = 0;
  const encoding = spyOn(JSON, 'stringify').mockImplementation((...args) => {
    const text: ReturnType<typeof JSON.stringify> = Reflect.apply(
      stringify,
      JSON,
      args,
    );
    encodedBytes += new TextEncoder().encode(text).byteLength;
    return text;
  });
  let response: Awaited<ReturnType<Client['callTool']>>;
  try {
    response = await client.callTool({ name: 'query_events', arguments: args });
  } finally {
    encoding.mockRestore();
  }
  // A 1 MiB snapshot leaves room for protocol copies within this 8 MiB budget.
  expect(encodedBytes).toBeLessThan(8 * 1024 * 1024);
  let page = ReadResultSchema.parse(response.structuredContent);
  const observed: unknown[] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!page.ok || page.data.kind !== 'events')
      throw new Error('Expected an event page.');
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength,
    ).toBeLessThan(MAX_BRIDGE_BYTES);
    expect(page.data.events.length).toBeGreaterThan(0);
    observed.push(...page.data.events.map((event) => event.metadata.order));
    expect(page.data.remaining).toBe(100 - observed.length);
    if (!page.data.cursor) break;
    page = ReadResultSchema.parse(
      (
        await client.callTool({
          name: 'query_events',
          arguments: { ...args, cursor: page.data.cursor },
        })
      ).structuredContent,
    );
  }
  expect(observed).toEqual(Array.from({ length: 100 }, (_, index) => index));
});

test('multibyte metadata respects the bridge byte limit on every cursor page', async () => {
  const { tools, client, targetId } = await setup();
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  const metadata = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [
      `field${index}`,
      '界'.repeat(8_000),
    ]),
  );
  for (let order = 0; order < 3; order++)
    first.diagnostics.emitDiagnostic('app.multibyte', { ...metadata, order });
  const args = {
    targetId,
    appId,
    view: 'recent',
    limit: 100,
    criteria: { kind: 'app.multibyte' },
  };
  let cursor: string | undefined;
  for (let order = 0; order < 3; order++) {
    const page = ReadResultSchema.parse(
      (
        await client.callTool({
          name: 'query_events',
          arguments: { ...args, cursor },
        })
      ).structuredContent,
    );
    if (!page.ok || page.data.kind !== 'events')
      throw new Error('Expected an event page.');
    expect(page.data.events.map((event) => event.metadata.order)).toEqual([
      order,
    ]);
    expect(page.data.remaining).toBe(2 - order);
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength,
    ).toBeLessThan(MAX_BRIDGE_BYTES);
    cursor = page.data.cursor;
    if (order < 2) expect(cursor).toBeString();
  }
  expect(cursor).toBeUndefined();
});

test('an oversized leading event reports a size failure instead of skipping to smaller evidence', async () => {
  const { tools, client, targetId } = await setup();
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  first.diagnostics.emitDiagnostic(
    'app.sample',
    Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `field${index}`,
        '界'.repeat(8_000),
      ]),
    ),
  );
  first.diagnostics.emitDiagnostic('app.sample', { order: 1 });
  const page = await client.callTool({
    name: 'query_events',
    arguments: {
      targetId,
      appId,
      view: 'recent',
      limit: 100,
      criteria: { kind: 'app.sample' },
    },
  });
  expect(page.structuredContent).toEqual({
    ok: false,
    error: 'limit_exceeded',
  });
  expect(page.isError).toBe(true);
});

test.each([
  'legacy',
  '2026-07-28',
] as const)('discovery teaches clients to inspect one app without changing scope over %s', async (protocol) => {
  const { client, host } = await setup({}, protocol);
  const instructions = client.getInstructions();
  expect(instructions).toMatch(
    /list_targets[\s\S]*list_apps[\s\S]*query_events[\s\S]*get_request/,
  );
  expect(instructions).toContain('reportedId');
  expect(instructions).toContain('untrusted data');
  expect(instructions).toContain('one recovery attempt');
  expect(instructions).not.toContain(host.pairingToken);
});

test('an explicitly paired collector appears as an inspectable target over MCP', async () => {
  const host = await createDevtoolsMcpServer({
    origin: 'http://localhost:4321',
  });
  releases.push(() => host.close());
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  releases.push(
    await connectDevtoolsBridge(tools, {
      endpoint: host.endpoint,
      token: host.pairingToken,
    }),
  );
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  const server = host.createServer();
  const client = new Client({ name: 'inspection-test', version: '1' });
  releases.push(
    () => client.close(),
    () => server.close(),
  );
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name: 'list_targets', arguments: {} });
  expect(result.structuredContent).toMatchObject({
    targets: [{ origin: 'http://localhost:4321' }],
  });
});

test('MCP lists app lifetimes without exposing their structural snapshots', async () => {
  const { tools, client, targetId } = await setup();
  releases.push(tools.attach(app()), tools.attach(app()));
  const result = await client.callTool({
    name: 'list_apps',
    arguments: { targetId },
  });
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: {
      kind: 'apps',
      apps: [
        { active: true, identity: 'reported' },
        { active: true, identity: 'reported' },
      ],
      omitted: 0,
    },
  });
  expect(JSON.stringify(result)).not.toContain('snapshot');
});

test.each([
  'legacy',
  '2026-07-28',
] as const)('a query isolates one app even when another app reports the same request identity over %s', async (protocol) => {
  const { tools, client, targetId } = await setup({}, protocol);
  const first = app();
  const second = app();
  releases.push(tools.attach(first), tools.attach(second));
  const appId = (await listedApps(client, targetId))[0].id;
  first.diagnostics.emitDiagnostic(
    'client.request.started',
    { marker: 'first' },
    undefined,
    'shared-request',
  );
  second.diagnostics.emitDiagnostic(
    'client.request.started',
    { marker: 'second' },
    undefined,
    'shared-request',
  );
  const result = await client.callTool({
    name: 'query_events',
    arguments: {
      targetId,
      appId,
      view: 'requests',
      criteria: { kind: 'client.request.started' },
    },
  });
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: {
      kind: 'events',
      matched: 1,
      events: [
        {
          kind: 'client.request.started',
          appId,
          requestId: 'shared-request',
          metadata: { marker: 'first' },
        },
      ],
    },
  });
  expect(JSON.stringify(result)).not.toContain('second');
});

test.each([
  'legacy',
  '2026-07-28',
] as const)('paging keeps its original evidence when new activity arrives over %s', async (protocol) => {
  const { tools, client, targetId } = await setup({}, protocol);
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  for (let order = 0; order < 3; order++)
    first.diagnostics.emitDiagnostic('app.sample', { order });
  const args = { targetId, appId, limit: 1, criteria: { kind: 'app.sample' } };
  const firstPage = ReadResultSchema.parse(
    (await client.callTool({ name: 'query_events', arguments: args }))
      .structuredContent,
  );
  if (!firstPage.ok || firstPage.data.kind !== 'events')
    throw new Error('Expected event page.');
  expect(firstPage.data).toMatchObject({
    matched: 3,
    remaining: 2,
    events: [{ metadata: { order: 0 } }],
  });
  expect('cursor' in firstPage.data && firstPage.data.cursor).toBeString();
  first.diagnostics.emitDiagnostic('app.sample', { order: 3 });
  const cursor = (firstPage.data as typeof firstPage.data & { cursor: string })
    .cursor;
  const secondPage = await client.callTool({
    name: 'query_events',
    arguments: { ...args, cursor },
  });
  expect(secondPage.structuredContent).toMatchObject({
    ok: true,
    data: { matched: 3, remaining: 1, events: [{ metadata: { order: 1 } }] },
  });
});

test.each([
  'legacy',
  '2026-07-28',
] as const)('request inspection reports producer timings and keeps reused identities ambiguous over %s', async (protocol) => {
  const { tools, client, targetId } = await setup({}, protocol);
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  first.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'request',
  );
  first.diagnostics.emitDiagnostic(
    'client.response.received',
    { source: 'request', outcome: 'succeeded', durationMs: 123 },
    undefined,
    'request',
  );
  first.diagnostics.emitDiagnostic(
    'client.response.applied',
    { source: 'request', actionFailures: 0, skippedActions: 0, durationMs: 2 },
    undefined,
    'request',
  );
  const args = { targetId, appId, requestId: 'request' };
  const result = await client.callTool({
    name: 'get_request',
    arguments: args,
  });
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: {
      request: {
        requestId: 'request',
        outcome: 'applied',
        roundTrip: { kind: 'reported', durationMs: 123 },
        application: { kind: 'reported', durationMs: 2 },
      },
    },
  });
  first.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'request',
  );
  const reused = await client.callTool({
    name: 'get_request',
    arguments: args,
  });
  expect(reused.structuredContent).toMatchObject({
    ok: true,
    data: {
      request: {
        outcome: 'ambiguous',
        roundTrip: { kind: 'unreported', reason: 'ambiguous' },
      },
    },
  });
});

test.each([
  'legacy',
  '2026-07-28',
] as const)('Clear tells clients to restart paging without mixing snapshots over %s', async (protocol) => {
  const { tools, client, targetId } = await setup({}, protocol);
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  for (let order = 0; order < 3; order++)
    first.diagnostics.emitDiagnostic('app.sample', { order });
  const args = { targetId, appId, limit: 1, criteria: { kind: 'app.sample' } };
  const result = ReadResultSchema.parse(
    (await client.callTool({ name: 'query_events', arguments: args }))
      .structuredContent,
  );
  if (!result.ok || result.data.kind !== 'events')
    throw new Error('Expected event page.');
  tools.clear();
  first.diagnostics.emitDiagnostic('app.sample', { order: 99 });
  const next = await client.callTool({
    name: 'query_events',
    arguments: { ...args, cursor: result.data.cursor },
  });
  expect(next.structuredContent).toEqual({ ok: false, error: 'stale_cursor' });
  expect(next.isError).toBe(true);
  expect(next.content[0]).toEqual({
    type: 'text',
    text: JSON.stringify({ ok: false, error: 'stale_cursor' }),
  });
  expect(recoveryText(next)).toContain('without cursor');
  expect(recoveryText(next)).toContain('new snapshot');
});

test('disposing a collector makes its retained snapshot unavailable through the bridge', async () => {
  const { tools, client, targetId } = await setup();
  releases.push(tools.attach(app()));
  tools.dispose();
  const result = await client.callTool({
    name: 'list_apps',
    arguments: { targetId },
  });
  expect(result.structuredContent).toEqual({
    ok: false,
    error: 'target_unavailable',
  });
});

test.each([
  'token',
  'origin',
] as const)('pairing rejects an unauthorized %s', async (invalid) => {
  const host = await createDevtoolsMcpServer({
    origin: 'http://localhost:4321',
  });
  releases.push(() => host.close());
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  if (invalid === 'origin') browserOrigin = 'http://localhost:4322';
  await expect(
    connectDevtoolsBridge(tools, {
      endpoint: host.endpoint,
      token: invalid === 'token' ? '0'.repeat(64) : host.pairingToken,
    }),
  ).rejects.toThrow('pairing failed');
});

test.each([
  'ws://example.com:123/devtools',
  'ws://127.0.0.1:123/other',
  'ws://127.0.0.1:123/devtools?token=private',
  'ws://user:pass@127.0.0.1:123/devtools',
])('a pairing credential cannot be sent to %s', async (endpoint) => {
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  await expect(
    connectDevtoolsBridge(tools, { endpoint, token: '0'.repeat(64) }),
  ).rejects.toThrow('local DevTools WebSocket endpoint');
});

test('reconnecting creates a fresh target and never aliases the disconnected handle', async () => {
  const { tools, host, client, targetId, disconnect } = await setup();
  disconnect();
  releases.push(
    await connectDevtoolsBridge(tools, {
      endpoint: host.endpoint,
      token: host.pairingToken,
    }),
  );
  const targets = await client.callTool({
    name: 'list_targets',
    arguments: {},
  });
  expect(targets.structuredContent).not.toMatchObject({
    targets: [{ id: targetId }],
  });
  const stale = await client.callTool({
    name: 'list_apps',
    arguments: { targetId },
  });
  expect(stale.structuredContent).toEqual({
    ok: false,
    error: 'target_unavailable',
  });
});

test.each([
  'legacy',
  '2026-07-28',
] as const)('MCP preserves application redaction and cannot stop a human recording over %s', async (protocol) => {
  const { tools, client, targetId, disconnect } = await setup(
    {
      redact: (value) =>
        JSON.parse(
          JSON.stringify(value).replaceAll('private-marker', '[REDACTED]'),
        ),
    },
    protocol,
  );
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  tools.startCapture();
  first.diagnostics.emitDiagnostic(
    'client.request.started',
    { marker: 'private-marker' },
    () => ({ intent: 'private-recorded-content' }),
    'request',
  );
  const before = tools.capture.getSnapshot();
  const result = await client.callTool({
    name: 'get_request',
    arguments: { targetId, appId, requestId: 'request' },
  });
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: { events: [{ metadata: { marker: '[REDACTED]' } }] },
  });
  expect(JSON.stringify(result)).not.toContain('private-marker');
  expect(JSON.stringify(result)).not.toContain('private-recorded-content');
  disconnect();
  expect(tools.capture.getSnapshot()).toEqual(before);
  expect(tools.capture.getSnapshot().active).toBe(true);
});

test('a cursor cannot change its app, event view, or criteria', async () => {
  const { tools, client, targetId } = await setup();
  const first = app();
  const second = app();
  releases.push(tools.attach(first), tools.attach(second));
  const [a, b] = await listedApps(client, targetId);
  for (let order = 0; order < 3; order++)
    first.diagnostics.emitDiagnostic('app.sample', { order });
  const args = {
    targetId,
    appId: a.id,
    limit: 1,
    criteria: { kind: 'app.sample' },
  };
  const result = ReadResultSchema.parse(
    (await client.callTool({ name: 'query_events', arguments: args }))
      .structuredContent,
  );
  if (!result.ok || result.data.kind !== 'events')
    throw new Error('Expected event page.');
  for (const change of [
    { appId: b.id },
    { view: 'requests' },
    { criteria: { kind: 'client.request.started' } },
  ]) {
    const rejected = await client.callTool({
      name: 'query_events',
      arguments: { ...args, ...change, cursor: result.data.cursor },
    });
    expect(rejected.structuredContent).toEqual({
      ok: false,
      error: 'stale_cursor',
    });
  }
});

test('an unavailable app never broadens an MCP query to another app', async () => {
  const { tools, client, targetId } = await setup();
  const first = app();
  releases.push(tools.attach(first));
  first.diagnostics.emitDiagnostic('app.sample', { marker: 'other-app' });
  const result = await client.callTool({
    name: 'query_events',
    arguments: { targetId, appId: crypto.randomUUID() },
  });
  expect(result.structuredContent).toEqual({
    ok: false,
    error: 'app_unavailable',
  });
  expect(recoveryText(result)).toContain('list_apps');
  expect(recoveryText(result)).toContain('same intended app');
  expect(JSON.stringify(result)).not.toContain('other-app');
});

test('oversized query evidence returns a size failure instead of silently skipping events', async () => {
  const { tools, client, targetId } = await setup({ maxActivityEvents: 1500 });
  const first = app();
  releases.push(tools.attach(first));
  const appId = (await listedApps(client, targetId))[0].id;
  for (let index = 0; index < 1200; index++)
    first.diagnostics.emitDiagnostic('app.large', { text: 'x'.repeat(1024) });
  const result = await client.callTool({
    name: 'query_events',
    arguments: { targetId, appId, criteria: { kind: 'app.large' } },
  });
  expect(result.structuredContent).toEqual({
    ok: false,
    error: 'limit_exceeded',
  });
  expect(recoveryText(result)).toContain('criteria');
  expect(recoveryText(result)).toContain('full-snapshot budget');
});

test('limit recovery respects the arguments accepted by each tool', async () => {
  const host = await createDevtoolsMcpServer({
    origin: 'http://localhost:4321',
  });
  releases.push(() => host.close());
  const socket = new NativeWebSocket(host.endpoint, {
    headers: { Origin: 'http://localhost:4321' },
  });
  releases.push(() => socket.close());
  const targetId = await new Promise<string>((resolve, reject) => {
    socket.addEventListener('error', () =>
      reject(new Error('Pairing failed.')),
    );
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          type: 'pair',
          version: 1,
          token: host.pairingToken,
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'paired') resolve(message.targetId);
      else
        socket.send(
          JSON.stringify({
            type: 'result',
            id: message.id,
            result: { ok: false, error: 'limit_exceeded' },
          }),
        );
    });
  });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  const server = serveStdio(() => host.createServer(), {
    transport: serverTransport,
  });
  const client = new Client(
    { name: 'limit-guidance-test', version: '1' },
    {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    },
  );
  releases.push(
    () => client.close(),
    () => server.close(),
  );
  await client.connect(clientTransport);
  const appId = crypto.randomUUID();
  for (const [name, args, expected] of [
    ['list_apps', { targetId }, 'list_apps accepts no criteria or limit'],
    [
      'get_request',
      { targetId, appId, requestId: 'same-request' },
      'get_request accepts no criteria',
    ],
    [
      'query_events',
      { targetId, appId },
      'narrow criteria only if it still answers the question',
    ],
  ] as const) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: 'limit_exceeded',
    });
    expect(result.content[0]).toEqual({
      type: 'text',
      text: JSON.stringify({ ok: false, error: 'limit_exceeded' }),
    });
    expect(recoveryText(result)).toContain(expected);
    expect(recoveryText(result)).toContain('Stop if it still fails');
    expect(JSON.stringify(result)).not.toContain(host.pairingToken);
  }
});

test('production cannot activate the browser bridge even with a valid local endpoint', async () => {
  const previous = process.env.NODE_ENV;
  const tools = createDevtools();
  releases.push(() => tools.dispose());
  try {
    process.env.NODE_ENV = 'production';
    await expect(
      connectDevtoolsBridge(tools, {
        endpoint: 'ws://127.0.0.1:123/devtools',
        token: '0'.repeat(64),
      }),
    ).rejects.toThrow('only during development');
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('app handles preserve pseudonymized correlation without exposing internal lifetime IDs', async () => {
  const { tools, client, targetId } = await setup({
    redact: (value) =>
      JSON.parse(JSON.stringify(value), (key, item) =>
        key === 'clientId' ? 'public-app' : item,
      ),
  });
  const first = app();
  releases.push(tools.attach(first));
  first.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    'private-request',
  );
  const listed = ReadResultSchema.parse(
    (await client.callTool({ name: 'list_apps', arguments: { targetId } }))
      .structuredContent,
  );
  if (!listed.ok || listed.data.kind !== 'apps')
    throw new Error('Expected apps.');
  expect(JSON.stringify(listed)).not.toContain(
    tools.getSnapshot().sessions[0].id,
  );
  expect(listed.data.apps[0]).toMatchObject({
    reportedId: 'public-app',
    identity: 'reported',
  });
  const result = await client.callTool({
    name: 'get_request',
    arguments: {
      targetId,
      appId: listed.data.apps[0].id,
      requestId: 'private-request',
    },
  });
  expect(result.structuredContent).toMatchObject({
    ok: true,
    data: {
      request: { requestId: 'private-request' },
      events: [{ metadata: { clientId: 'public-app' } }],
    },
  });
});

test.each([
  '[REDACTED]',
  'same-app',
])('unavailable or colliding projected identities stay unknown: %s', async (alias) => {
  const { tools, client, targetId } = await setup({
    redact: (value) =>
      JSON.parse(JSON.stringify(value), (key, item) =>
        key === 'clientId' ? alias : item,
      ),
  });
  releases.push(tools.attach(app()), tools.attach(app()));
  const apps = await listedApps(client, targetId);
  expect(apps.map((item) => item.identity)).toEqual(
    alias === '[REDACTED]'
      ? ['unavailable', 'unavailable']
      : ['ambiguous', 'ambiguous'],
  );
  const result = await client.callTool({
    name: 'query_events',
    arguments: { targetId, appId: apps[0].id },
  });
  expect(result.structuredContent).toEqual({
    ok: false,
    error: 'evidence_unavailable',
  });
});

test('a reused projected name never revives an expired app handle', async () => {
  const { tools, client, targetId } = await setup({
    maxSessions: 1,
    redact: (value) =>
      JSON.parse(JSON.stringify(value), (key, item) =>
        key === 'clientId' ? 'public-app' : item,
      ),
  });
  const detach = tools.attach(app());
  releases.push(detach);
  const old = (await listedApps(client, targetId))[0].id;
  detach();
  tools.clear();
  releases.push(tools.attach(app()));
  const current = (await listedApps(client, targetId))[0].id;
  expect(current).not.toBe(old);
  const result = await client.callTool({
    name: 'query_events',
    arguments: { targetId, appId: old },
  });
  expect(result.structuredContent).toEqual({
    ok: false,
    error: 'app_unavailable',
  });
});
