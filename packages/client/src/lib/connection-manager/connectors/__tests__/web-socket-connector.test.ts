import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { InstanceId, MessageId } from '@maelstrom-co/protocol';

import { WebSocketConnector } from '../web-socket-connector.js';
import { buildEnvelope, connectAndOpen } from './connector-test-helpers.js';
import { installFakeWebSocket } from './fake-websocket.js';

let teardown: (() => void) | null = null;

beforeEach(() => {
  teardown = installFakeWebSocket();
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe('WebSocketConnector wire contract', () => {
  test('serializes the envelope with id matching message.id', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('round-trip-1'));
    // Settle the promise so it doesn't outlive disconnect() and surface as
    // an unhandled rejection.
    const promise = connector.process(envelope);

    expect(ws.sent).toHaveLength(1);
    const payload = JSON.parse(ws.sent[0] as string) as {
      type: string;
      id: string;
      sessionId: string;
      timestamp: number;
      request: { type: string };
    };
    expect(payload.type).toBe('chart_request');
    expect(payload.id).toBe(envelope.id);
    expect(payload.sessionId).toBe(envelope.sessionId);
    expect(typeof payload.timestamp).toBe('number');
    expect(payload.request.type).toBe('chart_request');

    ws.emitJson({
      type: 'engine.maelstrom.response',
      requestId: envelope.id,
      response: {
        type: 'maelstrom_response',
        requestId: envelope.id,
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      },
    });
    await promise;
    await connector.disconnect();
  });

  test('resolves process() when a response with matching requestId arrives', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('round-trip-2'));
    const promise = connector.process(envelope);

    ws.emitJson({
      type: 'engine.maelstrom.response',
      requestId: envelope.id,
      response: {
        type: 'maelstrom_response',
        requestId: envelope.id,
        userMessage: 'ok',
        rationale: '',
        executionPlan: [{ instanceId: InstanceId('i-1'), action: 'noop' }],
        layout: { type: 'grid', positions: [] },
      },
    });

    const response = await promise;
    expect(response.requestId).toBe(envelope.id);
    expect(response.userMessage).toBe('ok');
    await connector.disconnect();
  });

  test('rejects process() when an engine.error frame correlates by requestId', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('round-trip-3'));
    const promise = connector.process(envelope);

    ws.emitJson({
      type: 'engine.error',
      requestId: envelope.id,
      error: 'envelope rejected',
    });

    await expect(promise).rejects.toThrow('envelope rejected');
    await connector.disconnect();
  });

  test('process() throws when the socket is not connected', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const envelope = buildEnvelope(MessageId('not-connected'));

    // Before connect()
    await expect(connector.process(envelope)).rejects.toThrow(
      'WebSocket not connected',
    );

    // After disconnect()
    await connectAndOpen(connector);
    await connector.disconnect();
    await expect(connector.process(envelope)).rejects.toThrow(
      'WebSocket not connected',
    );
  });
});
