import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventMessage,
  ChangeId,
  decodeClientEnvelope,
  err,
  InstanceId,
  isErr,
  MessageId,
  ok,
  RunId,
  SessionId,
  tilingLeafToken,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { flushMicrotasks } from '../../../../../test-utils/async-utils.js';
import {
  createMockResponse,
  createMockResponseVessel,
} from '../../../../../test-utils/mocks.js';
import { Orchestrator } from '../../../orchestrator/orchestrator.js';
import { WebSocketConnector } from '../web-socket-connector.js';
import { buildEnvelope, connectAndOpen } from './connector-test-helpers.js';
import { FakeWebSocket, installFakeWebSocket } from './fake-websocket.js';

const sessionId = SessionId('native-browser');
const runId = RunId('first-run');
const changeId = ChangeId('first-change');
let restore: () => void;
const clients: Orchestrator[] = [];

beforeEach(() => {
  restore = installFakeWebSocket();
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.dispose();
  restore();
});

function input(socket: FakeWebSocket, index: number) {
  const decoded = decodeClientEnvelope(socket.sent[index]);
  if (isErr(decoded)) throw decoded.error;
  expect(decoded.value.type).toBe('client.agent.input');
  if (decoded.value.type !== 'client.agent.input')
    throw new Error('Wrong route');
  return decoded.value.input;
}

function emit(socket: FakeWebSocket, event: AgentEvent) {
  socket.emitJson(AgentEventMessage({ sessionId, event }));
}

async function setup(timeout = 30_000) {
  const connector = new WebSocketConnector({
    url: 'ws://test',
    protocol: 'agent',
    timeout,
  });
  const client = new Orchestrator(connector, {
    sessionId,
    vessels: [createMockResponseVessel('create')],
  });
  clients.push(client);
  const connecting = client.connect();
  await flushMicrotasks();
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error('Socket missing');
  socket.emitOpen();
  await connecting;
  return { client, connector, socket };
}

function accept(socket: FakeWebSocket, index = 0) {
  const request = input(socket, index);
  if (request.type !== 'chart_request')
    throw new Error('Expected planning request');
  emit(socket, {
    type: 'accepted',
    version: AGENT_WIRE_VERSION,
    inputId: request.inputId,
    runId,
    disposition: 'ui_only',
    ack: 'Working',
  });
  return request;
}

function finish(socket: FakeWebSocket, code?: string) {
  emit(socket, {
    type: 'finished',
    version: AGENT_WIRE_VERSION,
    runId,
    ok: !code,
    reason: code ? 'error' : 'completed',
    reply: 'Done',
    ...(code ? { code, error: code } : {}),
    metrics: {
      turns: 0,
      toolCalls: 0,
      elapsedMs: 10,
      inputTokens: 0,
      outputTokens: 0,
    },
  });
}

describe('native browser application', () => {
  test('legacy subclass settlement methods remain callable', async () => {
    let acknowledged = false;
    class CustomConnector extends WebSocketConnector {
      override async applicationSettled() {
        acknowledged = true;
      }
    }
    const connector = new CustomConnector({ url: 'ws://test' });
    await connector.applicationSettled();
    expect(acknowledged).toBe(true);
    expect(
      new WebSocketConnector({ url: 'ws://test' }).applicationSettled,
    ).toBeUndefined();
  });

  for (const code of [
    'ui_ack_timeout',
    'ui_apply_unknown',
    'unrecognized_failure',
  ]) {
    test(`a ${code} terminal before UI delivery cannot reopen admission`, async () => {
      const { client, connector, socket } = await setup(100);
      const ticket = client.enqueueIntent('write');
      await flushMicrotasks();
      accept(socket);
      finish(socket, code);
      expect((await ticket.result).status).toBe('unknown');
      await expect(
        connector.process({ ...buildEnvelope(MessageId()), sessionId }),
      ).rejects.toThrow();
      expect(socket.sent).toHaveLength(1);
    });
  }

  test('a dependent request waits for the write and its acknowledgment, then captures the changed Chart', async () => {
    const { client, socket } = await setup();
    let completeWrite = () => {};
    let writes = 0;
    const writing = new Promise<void>((resolve) => {
      completeWrite = resolve;
    });
    client.commandProcessor.registerRunner(InstanceId('entry'), {
      create: async () => {
        await writing;
        writes++;
        return ok(undefined);
      },
    });
    const first = client.enqueueIntent('create an entry');
    await flushMicrotasks();
    const request = input(socket, 0);
    expect(request.type).toBe('chart_request');
    if (request.type !== 'chart_request') throw new Error('Missing snapshot');
    expect(request.request.context.updateReasons).toEqual([
      { type: 'user_intent', intent: 'create an entry' },
    ]);
    emit(socket, {
      type: 'accepted',
      version: AGENT_WIRE_VERSION,
      inputId: request.inputId,
      runId,
      disposition: 'ui_only',
      ack: 'Working',
    });
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: createMockResponse(request.inputId, 'entry', 'create'),
    });
    await flushMicrotasks();
    const next = client.enqueueIntent('use the entry');
    await flushMicrotasks();
    expect(writes).toBe(0);
    expect(socket.sent).toHaveLength(1);
    completeWrite();
    await flushMicrotasks();
    expect(writes).toBe(1);
    expect(input(socket, 1)).toMatchObject({
      type: 'ui_applied',
      changeId,
      status: 'applied',
      actionOutcomes: [{ ok: true }],
      chart: {
        context: { updateReasons: [] },
        instances: [{ instanceId: 'entry' }],
      },
    });
    expect(socket.sent).toHaveLength(2);
    emit(socket, {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId,
      ok: true,
      reason: 'completed',
      reply: 'Created',
      metrics: {
        turns: 0,
        toolCalls: 0,
        elapsedMs: 10,
        inputTokens: 0,
        outputTokens: 0,
      },
    });
    expect((await first.result).status).toBe('applied');
    await flushMicrotasks();
    expect(input(socket, 2)).toMatchObject({
      type: 'chart_request',
      request: {
        instances: [{ instanceId: 'entry' }],
        context: {
          updateReasons: [{ type: 'user_intent', intent: 'use the entry' }],
        },
      },
    });
    expect(writes).toBe(1);
    await client.dispose();
    await next.result;
  });

  test('duplicate UI delivery executes a non-idempotent write only once', async () => {
    const { client, socket } = await setup();
    const write = mock(() => ok(undefined));
    client.commandProcessor.registerRunner(InstanceId('entry'), {
      create: write,
    });
    const ticket = client.enqueueIntent('write');
    await flushMicrotasks();
    const request = accept(socket);
    const change = {
      type: 'ui_change' as const,
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: createMockResponse(request.inputId, 'entry', 'create'),
    };
    emit(socket, change);
    emit(socket, change);
    await flushMicrotasks();
    emit(socket, change);
    finish(socket);
    expect((await ticket.result).status).toBe('applied');
    emit(socket, change);
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    expect(socket.sent).toHaveLength(2);
  });

  test('positional evidence attributes repeated Action failures across interleaved Instances correctly', async () => {
    const { client, connector, socket } = await setup();
    let writes = 0;
    client.commandProcessor.registerRunner(InstanceId('entry'), {
      create: () =>
        ++writes === 1 ? ok(undefined) : err(new Error('write uncertain')),
    });
    client.commandProcessor.registerRunner(InstanceId('other'), {
      create: () => ok(undefined),
    });
    const ticket = client.enqueueIntent('three writes');
    await flushMicrotasks();
    const request = accept(socket);
    const response = createMockResponse(request.inputId, 'entry', 'create');
    const other = createMockResponse(request.inputId, 'other', 'create');
    if (response.layout.type !== 'tiling' || other.layout.type !== 'tiling')
      throw new Error('Expected tiling');
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: {
        ...response,
        layout: {
          ...response.layout,
          instances: [...response.layout.instances, ...other.layout.instances],
        },
        executionPlan: [
          ...response.executionPlan,
          ...other.executionPlan,
          ...response.executionPlan,
        ],
      },
    });
    await flushMicrotasks();
    expect(input(socket, 1)).toMatchObject({
      type: 'ui_applied',
      status: 'unknown',
      actionOutcomes: [{ ok: true }, { ok: true }, { ok: false }],
    });
    finish(socket, 'ui_apply_unknown');
    expect((await ticket.result).status).toBe('unknown');
    await expect(
      connector.process(buildEnvelope(MessageId())),
    ).rejects.toThrow();
    expect(socket.sent).toHaveLength(2);
    expect(writes).toBe(2);
  });

  test('acknowledgment reports observed geometry and retained Instances while the next request uses the desired mode', async () => {
    const { client, socket } = await setup();
    const ticket = client.enqueueIntent('show entry');
    await flushMicrotasks();
    const request = accept(socket);
    const response = createMockResponse(request.inputId, 'entry', 'create');
    const hidden = createMockResponse(request.inputId, 'hidden', 'create');
    if (response.layout.type !== 'tiling' || hidden.layout.type !== 'tiling')
      throw new Error('Expected tiling');
    const layout = {
      ...response.layout,
      tree: [tilingLeafToken(InstanceId('entry'))],
      instances: [...response.layout.instances, ...hidden.layout.instances],
    };
    client.setLayoutMode('grid');
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: { ...response, layout, executionPlan: [] },
    });
    await flushMicrotasks();
    expect(input(socket, 1)).toMatchObject({
      type: 'ui_applied',
      chart: {
        context: { layoutMode: 'tiling', updateReasons: [] },
        layout,
        instances: [{ instanceId: 'entry' }, { instanceId: 'hidden' }],
        vessels: [{ id: 'vessel-1' }],
      },
    });
    const next = client.enqueueIntent('next');
    finish(socket);
    expect((await ticket.result).status).toBe('applied');
    await flushMicrotasks();
    expect(input(socket, 2)).toMatchObject({
      type: 'chart_request',
      request: {
        context: { layoutMode: 'grid' },
        layout: { type: 'grid', positions: [] },
      },
    });
    await client.dispose();
    await next.result;
  });

  test('a definite Layout refusal permits a later request without executing Actions', async () => {
    const { client, socket } = await setup();
    const write = mock(() => ok(undefined));
    client.commandProcessor.registerRunner(InstanceId('entry'), {
      create: write,
    });
    const ticket = client.enqueueIntent('invalid layout');
    await flushMicrotasks();
    const request = accept(socket);
    const response = createMockResponse(request.inputId, 'entry', 'create');
    if (response.layout.type !== 'tiling') throw new Error('Expected tiling');
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: {
        ...response,
        layout: {
          ...response.layout,
          tree: [
            'V',
            tilingLeafToken(InstanceId('entry')),
            tilingLeafToken(InstanceId('entry')),
          ],
        },
      },
    });
    await flushMicrotasks();
    expect(input(socket, 1)).toMatchObject({
      type: 'ui_applied',
      status: 'failed',
      actionOutcomes: [],
      chart: { instances: [] },
    });
    finish(socket, 'ui_apply_failed');
    expect((await ticket.result).status).toBe('failed');
    const next = client.enqueueIntent('try a different layout');
    await flushMicrotasks();
    expect(socket.sent).toHaveLength(3);
    expect(write).not.toHaveBeenCalled();
    await client.dispose();
    await next.result;
  });

  for (const failure of [
    'disconnect',
    'early-finish',
    'wrong-run',
    'wrong-request',
    'malformed',
    'timeout',
  ] as const) {
    test(`${failure} cannot apply late writes or reuse the uncertain connector`, async () => {
      const clock = FakeTimers.install();
      try {
        const { client, connector, socket } = await setup(100);
        const write = mock(() => ok(undefined));
        client.commandProcessor.registerRunner(InstanceId('entry'), {
          create: write,
        });
        const ticket = client.enqueueIntent('write');
        await flushMicrotasks();
        const request = accept(socket);
        const change = {
          type: 'ui_change' as const,
          version: AGENT_WIRE_VERSION,
          runId,
          changeId,
          response: createMockResponse(request.inputId, 'entry', 'create'),
        };
        if (failure === 'disconnect') socket.emitClose(1000);
        if (failure === 'early-finish') finish(socket);
        if (failure === 'wrong-run')
          emit(socket, { ...change, runId: RunId('wrong') });
        if (failure === 'wrong-request')
          emit(socket, {
            ...change,
            response: { ...change.response, requestId: MessageId('wrong') },
          });
        if (failure === 'malformed')
          socket.emitJson({
            type: 'engine.agent.event',
            sessionId,
            event: { type: 'ui_change', version: 1 },
          });
        if (failure === 'timeout') await clock.tickAsync(100);
        await ticket.result;
        emit(socket, change);
        await flushMicrotasks();
        await expect(connector.connect(sessionId)).rejects.toThrow();
        await expect(
          connector.process(buildEnvelope(MessageId())),
        ).rejects.toThrow();
        expect(write).not.toHaveBeenCalled();
        expect(socket.sent).toHaveLength(1);
        await client.dispose();
      } finally {
        clock.uninstall();
      }
    });
  }

  test('the server deadline during a slow Action makes its late success unknown and never replays it', async () => {
    const { client, connector, socket } = await setup();
    let complete = () => {};
    let writes = 0;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    client.commandProcessor.registerRunner(InstanceId('entry'), {
      create: async () => {
        await pending;
        writes++;
        return ok(undefined);
      },
    });
    const ticket = client.enqueueIntent('slow write');
    await flushMicrotasks();
    const request = accept(socket);
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: createMockResponse(request.inputId, 'entry', 'create'),
    });
    await flushMicrotasks();
    finish(socket, 'ui_ack_timeout');
    complete();
    expect((await ticket.result).status).toBe('unknown');
    await expect(connector.connect(sessionId)).rejects.toThrow();
    expect(writes).toBe(1);
    expect(socket.sent).toHaveLength(1);
  });

  test('a superseded socket cannot satisfy an active request on the replacement connection', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      protocol: 'agent',
    });
    const old = await connectAndOpen(connector, sessionId);
    await connector.disconnect();
    const socket = await connectAndOpen(connector, sessionId);
    const envelope = { ...buildEnvelope(MessageId()), sessionId };
    const pending = connector.process(envelope);
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    emit(old, {
      type: 'accepted',
      version: AGENT_WIRE_VERSION,
      inputId: envelope.id,
      runId,
      disposition: 'ui_only',
      ack: 'stale',
    });
    emit(old, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: createMockResponse(envelope.id, 'entry', 'create'),
    });
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(socket.sent).toHaveLength(1);
    await connector.disconnect();
    await expect(pending).rejects.toThrow();
  });
});
