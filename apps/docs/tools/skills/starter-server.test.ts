import { afterEach, expect, test } from 'bun:test';
import {
  type ChartRequest,
  ChartRequestMessage,
  InstanceId,
  SessionId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { createStarterServer } from '../../starters/react/server';

const servers: ReturnType<typeof createStarterServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function start() {
  const server = createStarterServer(0);
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

function makeRequest(updateReasons: ChartRequest['context']['updateReasons']) {
  return ChartRequestMessage({
    sessionId: SessionId('starter-test'),
    request: {
      type: 'chart_request',
      context: {
        layoutMode: 'tiling',
        chartDimensions: { rows: 8, columns: 12 },
        updateReasons,
      },
      vessels: [
        {
          id: VesselId('greeting'),
          name: 'Greeting',
          description: 'Show a greeting',
          defaultVariant: VariantName('card'),
          variants: {
            card: { props: {}, minSize: { width: 2, height: 2 }, actions: [] },
          },
        },
      ],
      instances: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    },
  });
}

test('the runnable starter completes a real Engine turn without a provider key', async () => {
  const base = start();
  const envelope = makeRequest([
    { type: 'user_intent', intent: 'Show the greeting' },
  ]);
  const response = await fetch(`${base}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  expect(response.status).toBe(200);
  const value = await response.json();
  expect(value.requestId).toBe(envelope.id);
  expect(value.userMessage).toBe(
    'Local preview complete. No model was called.',
  );
  expect(value.layout.instances).toEqual([
    {
      instanceId: InstanceId('greeting-main'),
      vesselId: VesselId('greeting'),
      variant: VariantName('card'),
    },
  ]);
  expect(value.layout.tree).toEqual(['ID:greeting-main']);
});

test('automatic resize turns keep an existing greeting without creating one before the first intent', async () => {
  const base = start();
  const resizeReasons = [
    {
      type: 'chart_resize',
      previous: { rows: 6, columns: 10 },
      current: { rows: 8, columns: 12 },
    },
  ] as const;
  const send = async (envelope: ChartRequestMessage) => {
    const response = await fetch(`${base}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.requestId).toBe(envelope.id);
    return body;
  };
  const initial = await send(makeRequest(resizeReasons));
  expect(initial.layout.instances).toEqual([]);
  expect(initial.layout.tree).toEqual([]);

  const intent = makeRequest([
    { type: 'user_intent', intent: 'Show the greeting' },
  ]);
  const shown = await send(intent);
  expect(shown.layout.instances).toHaveLength(1);

  const resized = ChartRequestMessage({
    sessionId: intent.sessionId,
    request: {
      ...intent.request,
      context: { ...intent.request.context, updateReasons: resizeReasons },
      instances: shown.layout.instances,
      layout: shown.layout,
    },
  });
  expect(resized.id).not.toBe(intent.id);
  const preserved = await send(resized);
  expect(preserved.layout).toEqual(shown.layout);
});

test('a local learning server rejects foreign origins and invalid protocol messages without exposing internals', async () => {
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
