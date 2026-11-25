import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  type AgentEvent,
  AgentEventMessage,
  ChangeId,
  decodeClientEnvelope,
  EngineErrorMessage,
  err,
  InstanceId,
  isErr,
  MessageId,
  ok,
  RunId,
  SessionId,
  tilingLeafToken,
  VariantName,
  type VesselDefinition,
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

async function setup(
  timeout = 30_000,
  vessel = createMockResponseVessel('create'),
) {
  const connector = new WebSocketConnector({
    url: 'ws://test',
    protocol: 'agent',
    timeout,
  });
  const client = new Orchestrator(connector, {
    sessionId,
    vessels: [vessel],
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
      toolCalls: { requested: 0, admitted: 0 },
      elapsedMs: 10,
      inputTokens: 0,
      outputTokens: 0,
    },
  });
}

describe('native browser application', () => {
  test('captures accepted opaque Vessel values with wire semantics at Action completion', async () => {
    let phase = 'before-write';
    const value = { toJSON: () => ({ phase }) };
    const date = new Date('2026-01-02T00:00:00Z');
    const callback = () => {};
    const original = createMockResponseVessel('create');
    const vessel: VesselDefinition = {
      ...original,
      variants: {
        default: {
          ...original.variants.default,
          props: { value, callback, date },
          actions: [
            {
              ...original.variants.default.actions[0],
              parameters: [
                {
                  name: 'value',
                  type: 'object',
                  description: 'Opaque value',
                  defaultValue: value,
                  enum: [value, callback, date],
                },
                {
                  name: 'callback',
                  type: 'object',
                  description: 'Optional callback',
                  defaultValue: callback,
                },
              ],
            },
          ],
        },
      },
    };
    const { client, socket } = await setup(30_000, vessel);
    const write = mock(() => {
      phase = 'after-write';
      return ok(undefined);
    });
    client.commandProcessor.registerRunner(InstanceId('entry'), {
      create: write,
    });
    client.commandProcessor.events.on('command_complete', ({ command }) => {
      if (command.kind === 'execute_actions')
        queueMicrotask(() => {
          phase = 'later';
        });
    });
    const ticket = client.enqueueIntent('write with opaque metadata');
    await flushMicrotasks();
    const request = accept(socket);
    expect(
      request.request.vessels[0].variants[VariantName('default')].props.value,
    ).toEqual({
      phase: 'before-write',
    });
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: createMockResponse(request.inputId, 'entry', 'create'),
    });
    await flushMicrotasks();
    expect(write).toHaveBeenCalledTimes(1);
    expect(phase).toBe('later');
    expect(socket.sent).toHaveLength(2);
    const acknowledgment = input(socket, 1);
    if (acknowledgment.type !== 'ui_applied')
      throw new Error('Missing acknowledgment');
    const variant =
      acknowledgment.chart.vessels[0].variants[VariantName('default')];
    expect(variant.props).toEqual({
      value: { phase: 'after-write' },
      date: date.toISOString(),
    });
    expect(variant.actions[0].parameters).toEqual([
      {
        name: 'value',
        type: 'object',
        description: 'Opaque value',
        defaultValue: { phase: 'after-write' },
        enum: [{ phase: 'after-write' }, null, date.toISOString()],
      },
      { name: 'callback', type: 'object', description: 'Optional callback' },
    ]);
    finish(socket);
    expect((await ticket.result).status).toBe('applied');
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('a genuine capture failure stays unknown and stops admission after the write', async () => {
    let written = false;
    const original = createMockResponseVessel('create');
    const vessel: VesselDefinition = {
      ...original,
      variants: {
        default: {
          ...original.variants.default,
          props: {
            value: {
              toJSON() {
                if (written) throw new Error('capture unavailable');
                return 'ready';
              },
            },
          },
        },
      },
    };
    const { client, connector, socket } = await setup(30_000, vessel);
    const write = mock(() => {
      written = true;
      return ok(undefined);
    });
    client.commandProcessor.registerRunner(InstanceId('entry'), {
      create: write,
    });
    const ticket = client.enqueueIntent('write before capture fails');
    await flushMicrotasks();
    const request = accept(socket);
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: createMockResponse(request.inputId, 'entry', 'create'),
    });
    const result = await ticket.result;
    expect(result).toMatchObject({
      status: 'unknown',
      error: { message: 'capture unavailable' },
    });
    await expect(client.processIntent('retry')).rejects.toThrow();
    await expect(
      connector.process(buildEnvelope(MessageId())),
    ).rejects.toThrow();
    expect(socket.sent).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test('cross-session history errors reject promptly without stopping the active agent request', async () => {
    const { client, connector, socket } = await setup();
    const ticket = client.enqueueIntent('show entry');
    await flushMicrotasks();
    const request = accept(socket);
    const history = connector.getHistory(SessionId('other-session'));
    const historyRequest = decodeClientEnvelope(socket.sent[1]);
    if (isErr(historyRequest)) throw historyRequest.error;
    let failure: unknown;
    void history.catch((error: unknown) => {
      failure = error;
    });
    socket.emitJson(
      EngineErrorMessage({
        sessionId: SessionId('other-session'),
        requestId: historyRequest.value.id,
        error: 'history backend down',
        code: 'HistoryError',
      }),
    );
    await flushMicrotasks();
    expect(failure).toMatchObject({
      message: 'history backend down',
      code: 'HistoryError',
    });
    socket.emitJson(
      EngineErrorMessage({
        sessionId: SessionId('other-session'),
        requestId: request.inputId,
        error: 'unrelated session error',
      }),
    );
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: {
        ...createMockResponse(request.inputId, 'entry', 'create'),
        executionPlan: [],
      },
    });
    await flushMicrotasks();
    finish(socket);
    expect((await ticket.result).status).toBe('applied');
  });

  test.each(['text', 'voice'] as const)(
    '%s conversation input cannot compete with client-dispatched native requests',
    async (source) => {
      const { client, socket } = await setup();
      await expect(
        client.sendMessage('write through conversation', { source }).result,
      ).resolves.toMatchObject({ status: 'not_submitted' });
      expect(socket.sent).toHaveLength(0);
      const write = mock(() => ok(undefined));
      client.commandProcessor.registerRunner(InstanceId('entry'), {
        create: write,
      });
      const ticket = client.enqueueIntent('write through dispatch');
      await flushMicrotasks();
      const request = accept(socket);
      await expect(
        client.sendMessage('competing write', { source }).result,
      ).resolves.toMatchObject({ status: 'not_submitted' });
      expect(socket.sent).toHaveLength(1);
      emit(socket, {
        type: 'ui_change',
        version: AGENT_WIRE_VERSION,
        runId,
        changeId,
        response: createMockResponse(request.inputId, 'entry', 'create'),
      });
      await flushMicrotasks();
      finish(socket);
      expect((await ticket.result).status).toBe('applied');
      expect(write).toHaveBeenCalledTimes(1);
      expect(socket.sent).toHaveLength(2);
    },
  );

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

  test('a correlated busy refusal permits a later explicit dispatch with the current Chart', async () => {
    const { client, socket } = await setup();
    const first = client.enqueueIntent('show the order');
    await flushMicrotasks();
    const request = input(socket, 0);
    if (request.type !== 'chart_request') throw new Error('Missing request');
    emit(socket, {
      type: 'error',
      version: AGENT_WIRE_VERSION,
      inputId: request.inputId,
      code: 'connection_busy',
      error: 'Wait for pending work.',
    });
    expect(await first.result).toMatchObject({
      error: { code: 'connection_busy' },
    });
    await flushMicrotasks();
    expect(socket.sent).toHaveLength(1);

    client.chartManager.setDimensions({ columns: 17, rows: 9 });
    const second = client.enqueueIntent('show the receipt');
    await flushMicrotasks();
    expect(socket.sent).toHaveLength(2);
    const next = accept(socket, 1);
    expect(next.inputId).not.toBe(request.inputId);
    expect(next.request.context.chartDimensions).toEqual({
      columns: 17,
      rows: 9,
    });
    emit(socket, {
      type: 'ui_change',
      version: AGENT_WIRE_VERSION,
      runId,
      changeId,
      response: {
        ...createMockResponse(next.inputId, 'entry', 'create'),
        executionPlan: [],
      },
    });
    await flushMicrotasks();
    finish(socket);
    expect((await second.result).status).toBe('applied');
    expect(socket.sent).toHaveLength(3);
  });

  test.each([
    'wrong input',
    'missing input',
    'run scoped',
    'change scoped',
    'already accepted',
    'unknown code',
  ])(
    'an ambiguous refusal (%s) cannot reopen native admission',
    async (scenario) => {
      const { client, connector, socket } = await setup();
      const first = client.enqueueIntent('show the order');
      await flushMicrotasks();
      const request = input(socket, 0);
      if (request.type !== 'chart_request') throw new Error('Missing request');
      if (scenario === 'already accepted') accept(socket);
      emit(socket, {
        type: 'error',
        version: AGENT_WIRE_VERSION,
        ...(scenario === 'missing input'
          ? {}
          : {
              inputId:
                scenario === 'wrong input'
                  ? MessageId('other')
                  : request.inputId,
            }),
        ...(scenario === 'run scoped' ? { runId } : {}),
        ...(scenario === 'change scoped' ? { changeId } : {}),
        code:
          scenario === 'unknown code'
            ? 'unrecognized_failure'
            : 'connection_busy',
        error: 'Cannot confirm what happened.',
      });
      expect((await first.result).status).toBe('unknown');
      await expect(
        connector.process({ ...buildEnvelope(MessageId()), sessionId }),
      ).rejects.toThrow();
      expect(socket.sent).toHaveLength(1);
    },
  );

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
        toolCalls: { requested: 0, admitted: 0 },
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
    const { client, connector, socket } = await setup();
    const conversationEvent = mock(() => {});
    connector.onEvent(conversationEvent);
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
    expect(conversationEvent).not.toHaveBeenCalled();
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
