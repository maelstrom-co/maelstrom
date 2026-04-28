import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MessageId } from '@maelstrom-co/protocol';

import { VoiceWebSocketConnector } from '../voice-web-socket-connector.js';
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

describe('VoiceWebSocketConnector wire contract', () => {
  test('wraps the envelope inside client.maelstrom.process with envelope.id intact', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('voice-round-trip-1'));
    const promise = connector.process(envelope);

    expect(ws.sent).toHaveLength(1);
    const payload = JSON.parse(ws.sent[0] as string) as {
      type: string;
      timestamp: number;
      request: {
        type: string;
        id: string;
        sessionId: string;
        timestamp: number;
        request: { type: string };
      };
    };
    expect(payload.type).toBe('client.maelstrom.process');
    // The wire-wrapped envelope is at `payload.request` (the inner ChartRequest
    // is at `payload.request.request`).
    expect(payload.request.type).toBe('chart_request');
    expect(payload.request.id).toBe(envelope.id);
    expect(payload.request.sessionId).toBe(envelope.sessionId);
    expect(payload.request.request.type).toBe('chart_request');

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
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('voice-round-trip-2'));
    const promise = connector.process(envelope);

    ws.emitJson({
      type: 'engine.maelstrom.response',
      requestId: envelope.id,
      response: {
        type: 'maelstrom_response',
        requestId: envelope.id,
        userMessage: 'hi',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      },
    });

    const response = await promise;
    expect(response.requestId).toBe(envelope.id);
    expect(response.userMessage).toBe('hi');
    await connector.disconnect();
  });

  test('rejects process() when an engine.error frame correlates by requestId', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('voice-round-trip-3'));
    const promise = connector.process(envelope);

    ws.emitJson({
      type: 'engine.error',
      requestId: envelope.id,
      error: 'voice envelope rejected',
    });

    await expect(promise).rejects.toThrow('voice envelope rejected');
    await connector.disconnect();
  });
});
