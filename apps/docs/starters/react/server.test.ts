import { afterEach, expect, test } from 'bun:test';
import {
  type ChartRequest,
  ChartRequestMessage,
  SessionId,
  type TilingLayout,
  validateVessel,
} from '@maelstrom-co/protocol';
import { createStarterServer } from './server';
import {
  notesId,
  notesVessel,
  tasksId,
  tasksVessel,
  workspaceLayout,
} from './src/workspace';

const servers: ReturnType<typeof createStarterServer>[] = [];
const providers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const provider of providers.splice(0)) provider.stop(true);
});
function start(options: Parameters<typeof createStarterServer>[1] = {}) {
  const server = createStarterServer(0, options);
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}
const catalog = [tasksVessel, notesVessel].map((definition) => {
  const result = validateVessel(definition);
  if (!result.valid) throw new Error('The starter catalog must be valid');
  return result.vessel;
});
function makeRequest(
  reasons: ChartRequest['context']['updateReasons'],
  options: { layout?: TilingLayout; columns?: number } = {},
) {
  const layout = options.layout ?? workspaceLayout();
  return ChartRequestMessage({
    sessionId: SessionId('starter-test'),
    request: {
      type: 'chart_request',
      context: {
        layoutMode: 'tiling',
        chartDimensions: { rows: 8, columns: options.columns ?? 12 },
        updateReasons: reasons,
      },
      vessels: catalog,
      instances: layout.instances,
      layout,
    },
  });
}
async function send(base: string, envelope: ChartRequestMessage) {
  const response = await fetch(`${base}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  expect(response.status).toBe(200);
  const value = await response.json();
  expect(value.requestId).toBe(envelope.id);
  return value;
}

test('a local request changes both the note view and the space available to edit it', async () => {
  const value = await send(
    start(),
    makeRequest([
      {
        type: 'user_intent',
        intent:
          'Make my note editable and give it more room while keeping my tasks visible',
      },
    ]),
  );
  expect(value.layout.tree).toEqual([
    'V:1,2',
    `ID:${tasksId}`,
    `ID:${notesId}`,
  ]);
  expect(
    value.layout.instances.find(
      (instance: { instanceId: string }) => instance.instanceId === notesId,
    ).variant,
  ).toBe('editor');
  expect(value.executionPlan).toEqual([]);
});

test('restoring the starting view keeps both instances and returns the note to preview without an action', async () => {
  const value = await send(
    start(),
    makeRequest(
      [
        {
          type: 'user_intent',
          intent: 'Return to the starting layout with tasks and a note preview',
        },
      ],
      { layout: workspaceLayout(12, true) },
    ),
  );
  expect(value.layout.tree).toEqual([
    'V:3,2',
    `ID:${tasksId}`,
    `ID:${notesId}`,
  ]);
  expect(value.layout.instances).toEqual(workspaceLayout().instances);
  expect(value.executionPlan).toEqual([]);
});

test('the first add-task turn introduces its target layout and returns the declared action with parsed parameters', async () => {
  const value = await send(
    start(),
    makeRequest(
      [{ type: 'user_intent', intent: 'Add "Prepare the launch" to my tasks' }],
      { layout: { type: 'tiling', tree: [], instances: [] } },
    ),
  );
  expect(
    value.layout.instances.some(
      (instance: { instanceId: string }) => instance.instanceId === tasksId,
    ),
  ).toBe(true);
  expect(value.executionPlan).toEqual([
    {
      instanceId: tasksId,
      action: 'addTask',
      params: { title: 'Prepare the launch' },
    },
  ]);
});

test('resize preserves the current note view and instance identities without replaying a task action', async () => {
  const current = workspaceLayout(12, true);
  const value = await send(
    start(),
    makeRequest(
      [
        {
          type: 'chart_resize',
          previous: { rows: 8, columns: 12 },
          current: { rows: 8, columns: 4 },
        },
      ],
      { layout: current, columns: 4 },
    ),
  );
  expect(value.layout.tree).toEqual([
    'H:1,2',
    `ID:${tasksId}`,
    `ID:${notesId}`,
  ]);
  expect(value.layout.instances).toEqual(current.instances);
  expect(value.executionPlan).toEqual([]);
});

test('unsupported local text gives honest guidance and does not invent an action', async () => {
  const value = await send(
    start(),
    makeRequest([{ type: 'user_intent', intent: 'Write a book' }]),
  );
  expect(value.userMessage).toContain('Local mode');
  expect(value.executionPlan).toEqual([]);
});

test('the local server rejects foreign origins and invalid wire data without exposing implementation details', async () => {
  const base = start();
  const denied = await fetch(`${base}/api/process`, {
    method: 'POST',
    headers: { Origin: 'https://unrelated.example' },
    body: '{}',
  });
  expect(denied.status).toBe(403);
  const invalid = await fetch(`${base}/api/process`, {
    method: 'POST',
    body: '{}',
  });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ error: 'Invalid chart request' });
  const traversal = await fetch(`${base}/assets/%2e%2e%2fserver.ts`);
  expect(traversal.status).toBe(404);
  expect(await traversal.text()).not.toContain('createEngine');
});

test('live mode requires a server key and exposes only its public configuration', async () => {
  expect(() => start({ mode: 'openai' })).toThrow('OPENAI_API_KEY');
  const base = start({ mode: 'openai', apiKey: 'sk-starter-test-only' });
  const response = await fetch(`${base}/api/config`);
  expect(await response.json()).toEqual({
    mode: 'openai',
    model: 'gpt-6-luna',
  });
});

test('a slow live intent completes once, while resize and rejected requests never call the provider', async () => {
  const calls: Record<string, unknown>[] = [];
  const candidate = {
    userMessage: 'Your note has more room.',
    rationale: 'Use the declared editor view.',
    executionPlan: [],
    layout: {
      tree: workspaceLayout(12, true).tree,
      instances: workspaceLayout(12, true).instances,
    },
  };
  const provider = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 30,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe('/v1/responses');
      expect(request.headers.get('authorization')).toBe(
        'Bearer sk-starter-test-only',
      );
      const body = await request.json();
      calls.push(body);
      await Bun.sleep(16_000);
      const text = JSON.stringify(candidate);
      const response = {
        id: 'resp_starter',
        model: 'gpt-6-luna',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_starter',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      };
      if (!body.stream) return Response.json(response);
      const events = [
        { type: 'response.created', response: { ...response, output: [] } },
        {
          type: 'response.output_text.delta',
          delta: text,
          item_id: 'msg_starter',
          output_index: 0,
          content_index: 0,
        },
        { type: 'response.completed', response },
      ];
      return new Response(
        events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(''),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  });
  providers.push(provider);
  const base = start({
    mode: 'openai',
    apiKey: 'sk-starter-test-only',
    baseURL: `http://127.0.0.1:${provider.port}/v1`,
  });
  await send(
    base,
    makeRequest(
      [
        {
          type: 'chart_resize',
          previous: { rows: 8, columns: 12 },
          current: { rows: 8, columns: 4 },
        },
      ],
      { columns: 4 },
    ),
  );
  expect(calls).toHaveLength(0);
  for (const [envelope, origin, status] of [
    [
      makeRequest([{ type: 'user_intent', intent: 'x'.repeat(501) }]),
      undefined,
      400,
    ],
    [
      makeRequest([{ type: 'user_intent', intent: 'Give my notes more room' }]),
      'https://unrelated.example',
      403,
    ],
  ] as const) {
    const response = await fetch(`${base}/api/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin && { Origin: origin }),
      },
      body: JSON.stringify(envelope),
    });
    expect(response.status).toBe(status);
  }
  expect(calls).toHaveLength(0);
  const result = await send(
    base,
    makeRequest([
      { type: 'user_intent', intent: 'Make my note editable and larger' },
    ]),
  );
  expect(
    result.layout.instances.find(
      (instance: { instanceId: string }) => instance.instanceId === notesId,
    ).variant,
  ).toBe('editor');
  expect(calls).toHaveLength(1);
  expect(calls[0].model).toBe('gpt-6-luna');
  expect(calls[0].max_output_tokens).toBe(2048);
  expect(calls[0].reasoning).toEqual({ effort: 'none' });
  expect(calls[0].text).toMatchObject({ format: { type: 'json_schema' } });
  await send(
    base,
    makeRequest(
      [
        {
          type: 'chart_resize',
          previous: { rows: 8, columns: 12 },
          current: { rows: 8, columns: 4 },
        },
      ],
      { columns: 4, layout: { type: 'tiling', ...result.layout } },
    ),
  );
  expect(calls).toHaveLength(1);
}, 25_000);

test('provider failures do not expose credentials or provider payloads to the browser', async () => {
  let calls = 0;
  const provider = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      calls++;
      return Response.json(
        { error: { message: 'sk-starter-test-only PRIVATE_PROVIDER_DETAIL' } },
        { status: 401 },
      );
    },
  });
  providers.push(provider);
  const base = start({
    mode: 'openai',
    apiKey: 'sk-starter-test-only',
    baseURL: `http://127.0.0.1:${provider.port}/v1`,
  });
  const response = await fetch(`${base}/api/process`, {
    method: 'POST',
    body: JSON.stringify(
      makeRequest([{ type: 'user_intent', intent: 'Make notes larger' }]),
    ),
  });
  expect(response.status).toBe(422);
  const text = await response.text();
  expect(text).not.toContain('sk-starter');
  expect(text).not.toContain('PRIVATE_PROVIDER_DETAIL');
  expect(calls).toBe(1);
});
