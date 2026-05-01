import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { MessageId, type MaelstromResponse } from '@maelstrom-co/protocol';
import type { VoiceServerMessage } from '@maelstrom-co/protocol-old';

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

describe('VoiceWebSocketConnector silent-failure hygiene', () => {
  test('parse failure logs the bound error even when debug is false', async () => {
    // Default debug: false — production path that today silently swallows
    // JSON.parse exceptions.
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      ws.onmessage?.({ data: '{not-json' });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const callArgs = errorSpy.mock.calls[0];
      expect(callArgs[0]).toContain('[VoiceConnector] Failed to parse message');
      expect(callArgs[1]).toBeInstanceOf(Error);
      expect(callArgs[2]).toBe('{not-json');
    } finally {
      errorSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('unmatched engine.maelstrom.response warns AND still routes to push and voice listeners', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const pushed: MaelstromResponse[] = [];
    connector.onPushMessage((response) => {
      pushed.push(response);
    });

    const voiceMessages: VoiceServerMessage[] = [];
    connector.onVoiceMessage((message) => {
      voiceMessages.push(message);
    });

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ws.emitJson({
        type: 'engine.maelstrom.response',
        requestId: 'voice-no-pending',
        response: {
          type: 'maelstrom_response',
          requestId: 'voice-no-pending',
          userMessage: 'voice push',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });

      // Warn fired
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        '[VoiceConnector] engine.maelstrom.response with no pending request',
      );
      expect(warnSpy.mock.calls[0][0]).toContain('voice-no-pending');

      // Existing push fallback preserved
      expect(pushed).toHaveLength(1);
      expect(pushed[0].userMessage).toBe('voice push');

      // Voice listener also received the unmatched frame — verifies the full
      // fallback path (both forEach loops) runs after the warn.
      expect(voiceMessages).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.maelstrom.response with empty-string requestId does not push to listeners', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const pushed: MaelstromResponse[] = [];
    connector.onPushMessage((response) => {
      pushed.push(response);
    });

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ws.emitJson({
        type: 'engine.maelstrom.response',
        requestId: '',
        response: {
          type: 'maelstrom_response',
          requestId: '',
          userMessage: 'should be ignored',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });

      expect(warnSpy).not.toHaveBeenCalled();
      // Crucially: the empty-id frame did NOT get treated as an unsolicited
      // push and routed to pushMessageListeners (the misroute the spec calls
      // out for VoiceWebSocketConnector).
      expect(pushed).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.maelstrom.response with non-string requestId is ignored', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const pushed: MaelstromResponse[] = [];
    connector.onPushMessage((response) => {
      pushed.push(response);
    });

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ws.emitJson({
        type: 'engine.maelstrom.response',
        // Wire delivers a number — the double cast bypasses TS to test the
        // runtime guard against a malformed payload.
        requestId: 42 as unknown as string,
        response: {
          type: 'maelstrom_response',
          requestId: 'irrelevant',
          userMessage: 'should be ignored',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(pushed).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.error with empty-string requestId does not reject pending requests', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('voice-valid-pending'));
    const promise = connector.process(envelope);

    ws.emitJson({
      type: 'engine.error',
      requestId: '',
      error: 'should not propagate',
    });

    ws.emitJson({
      type: 'engine.maelstrom.response',
      requestId: envelope.id,
      response: {
        type: 'maelstrom_response',
        requestId: envelope.id,
        userMessage: 'ok',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      },
    });

    const response = await promise;
    expect(response.userMessage).toBe('ok');
    await connector.disconnect();
  });

  test('engine.error with non-string requestId does not reject pending requests', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('voice-valid-pending-2'));
    const promise = connector.process(envelope);

    ws.emitJson({
      type: 'engine.error',
      // Wire delivers a number — the double cast bypasses TS to test the
      // runtime guard against a malformed payload.
      requestId: 42 as unknown as string,
      error: 'should not propagate',
    });

    ws.emitJson({
      type: 'engine.maelstrom.response',
      requestId: envelope.id,
      response: {
        type: 'maelstrom_response',
        requestId: envelope.id,
        userMessage: 'ok',
        rationale: '',
        executionPlan: [],
        layout: { type: 'grid', positions: [] },
      },
    });

    const response = await promise;
    expect(response.userMessage).toBe('ok');
    await connector.disconnect();
  });
});
