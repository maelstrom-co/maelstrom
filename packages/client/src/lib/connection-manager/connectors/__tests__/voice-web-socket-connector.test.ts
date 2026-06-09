import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  MessageId,
  SessionId,
  type MaelstromResponse,
  type SessionHistoryEntry,
  type VoiceServerMessage,
} from '@maelstrom-co/protocol';

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
      sessionId: 'session-voice',
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
      sessionId: 'session-voice',
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

  test('malformed engine.maelstrom.response rejects the awaiting process() caller', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('voice-malformed-1'));
    const promise = connector.process(envelope);

    // Correlatable requestId (matches the pending request) but a malformed
    // payload: `response` is not an object. The schema rejects it at the wire
    // boundary, so the awaiting caller is rejected with a useful error rather
    // than resolved with a coerced frame.
    ws.emitJson({
      type: 'engine.maelstrom.response',
      sessionId: 'session-voice',
      requestId: envelope.id,
      response: 'not-an-object',
    });

    await expect(promise).rejects.toThrow(/malformed payload/i);
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
        sessionId: 'session-voice',
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

  test('malformed engine.maelstrom.response with no pending request warns and routes nowhere', async () => {
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
      // Correlatable requestId, no pending request, malformed body. The reject
      // finds no pending caller, so the connector takes the no-pending warn
      // branch and must NOT fall through to the voice/push fan-out.
      ws.emitJson({
        type: 'engine.maelstrom.response',
        sessionId: 'session-voice',
        requestId: 'no-pending-malformed',
        response: 'not-an-object',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        'engine.maelstrom.response with malformed payload and no pending request',
      );
      expect(pushed).toHaveLength(0);
      expect(voiceMessages).toHaveLength(0);
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

      // The empty-id frame fails schema validation in the voice branch: it is
      // surfaced (warn) and dropped rather than silently swallowed.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        'dropping malformed voice message',
      );
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

      // Non-string requestId fails schema validation in the voice branch:
      // surfaced (warn) and dropped, never routed as a push.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        'dropping malformed voice message',
      );
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

    // The malformed engine.error (non-correlatable requestId) is surfaced and
    // dropped in the voice branch; spy so the warn doesn't clutter output.
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    ws.emitJson({
      type: 'engine.error',
      requestId: '',
      error: 'should not propagate',
    });

    ws.emitJson({
      type: 'engine.maelstrom.response',
      sessionId: 'session-voice',
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
    warnSpy.mockRestore();
    await connector.disconnect();
  });

  test('engine.error with non-string requestId does not reject pending requests', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('voice-valid-pending-2'));
    const promise = connector.process(envelope);

    // The malformed engine.error (non-correlatable requestId) is surfaced and
    // dropped in the voice branch; spy so the warn doesn't clutter output.
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    ws.emitJson({
      type: 'engine.error',
      // Wire delivers a number — the double cast bypasses TS to test the
      // runtime guard against a malformed payload.
      requestId: 42 as unknown as string,
      error: 'should not propagate',
    });

    ws.emitJson({
      type: 'engine.maelstrom.response',
      sessionId: 'session-voice',
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
    warnSpy.mockRestore();
    await connector.disconnect();
  });

  test('whitespace-only requestId is treated as missing and does not crash the handler', async () => {
    // `isCorrelatableId` strips falsy/blank values before MessageId() runs.
    // Without that guard, branding a whitespace-only string would throw and
    // propagate through the catch as a parse error — pin the no-crash path.
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const pushed: MaelstromResponse[] = [];
    connector.onPushMessage((response) => {
      pushed.push(response);
    });

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      ws.emitJson({
        type: 'engine.maelstrom.response',
        requestId: '   ',
        response: {
          type: 'maelstrom_response',
          requestId: '   ',
          userMessage: 'should be ignored',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });

      // Whitespace fails `isCorrelatableId`, so the frame falls to the voice
      // branch where the schema rejects it: surfaced (warn) and dropped, never
      // routed as a push, and crucially without throwing a parse error.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        'dropping malformed voice message',
      );
      expect(errorSpy).not.toHaveBeenCalled();
      expect(pushed).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      await connector.disconnect();
    }
  });
});

describe('engine.stt.ready sticky replay', () => {
  test('early subscriber receives event normally (no regression)', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-1', timestamp: 1 });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('engine.stt.ready');
    await connector.disconnect();
  });

  test('late subscriber gets replay on next microtask', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-1', timestamp: 1 });

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    // replay is deferred via queueMicrotask, so it has not fired yet
    expect(received).toHaveLength(0);
    await null;
    expect(received).toHaveLength(1);
    expect((received[0] as { sessionId: string }).sessionId).toBe('session-1');
    await connector.disconnect();
  });

  test('late subscriber gets replay exactly once and still receives subsequent live events', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-1', timestamp: 1 });

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    await null; // drain microtask — replay fires
    expect(received).toHaveLength(1);
    expect((received[0] as { sessionId: string }).sessionId).toBe('session-1');

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-2', timestamp: 1 });

    expect(received).toHaveLength(2);
    expect((received[1] as { sessionId: string }).sessionId).toBe('session-2');
    await connector.disconnect();
  });

  test('late subscriber does not get stale event after disconnect then reconnect', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    let ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-A', timestamp: 1 });
    await connector.disconnect();

    // reconnect without emitting engine.stt.ready again
    ws = await connectAndOpen(connector);

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    await null;
    expect(received).toHaveLength(0);
    await connector.disconnect();
  });

  test('sticky clears on reconnect and new event replays correctly', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    let ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-A', timestamp: 1 });
    await connector.disconnect();

    ws = await connectAndOpen(connector);
    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-B', timestamp: 1 });

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    await null;
    expect(received).toHaveLength(1);
    expect((received[0] as { type: string; sessionId: string }).sessionId).toBe(
      'session-B',
    );
    await connector.disconnect();
  });

  test('late subscriber does not get stale replay after unclean ws close', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-A', timestamp: 1 });
    ws.emitClose(1006);

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    await null;
    expect(received).toHaveLength(0);
  });

  test('engine.stt.ready with malformed sessionId is not cached for replay', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    ws.emitJson({ type: 'engine.stt.ready' });

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    await null;
    expect(received).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
    await connector.disconnect();
  });

  test('multiple late subscribers each receive an independent replay', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-1', timestamp: 1 });

    const a: VoiceServerMessage[] = [];
    const b: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => a.push(msg));
    connector.onVoiceMessage((msg) => b.push(msg));

    await null;
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect((a[0] as { sessionId: string }).sessionId).toBe('session-1');
    expect((b[0] as { sessionId: string }).sessionId).toBe('session-1');
    await connector.disconnect();
  });

  test('subscribe before connect: replay fires after ready arrives', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    const ws = await connectAndOpen(connector);
    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-1', timestamp: 1 });

    expect(received).toHaveLength(1);
    expect((received[0] as { sessionId: string }).sessionId).toBe('session-1');
    await connector.disconnect();
  });

  test('last-write-wins on back-to-back ready events', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-A', timestamp: 1 });
    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-B', timestamp: 1 });

    const received: VoiceServerMessage[] = [];
    connector.onVoiceMessage((msg) => received.push(msg));

    await null;
    expect(received).toHaveLength(1);
    expect((received[0] as { sessionId: string }).sessionId).toBe('session-B');
    await connector.disconnect();
  });

  test('unsubscribe before microtask drain cancels the replay', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    ws.emitJson({ type: 'engine.stt.ready', sessionId: 'session-1', timestamp: 1 });

    const received: VoiceServerMessage[] = [];
    const off = connector.onVoiceMessage((msg) => received.push(msg));
    off();

    await null;
    expect(received).toHaveLength(0);
    await connector.disconnect();
  });
});

describe('VoiceWebSocketConnector getHistory', () => {
  test('sends client.history.get with the supplied sessionId and a generated request id', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);
    const target = SessionId('persisted');

    const promise = connector.getHistory(target);
    expect(ws.sent).toHaveLength(1);
    const payload = JSON.parse(ws.sent[0] as string) as {
      type: string;
      id: string;
      sessionId: string;
    };
    expect(payload.type).toBe('client.history.get');
    expect(payload.sessionId).toBe(target);
    expect(typeof payload.id).toBe('string');
    expect(payload.id.length).toBeGreaterThan(0);

    ws.emitJson({
      type: 'engine.history.response',
      requestId: payload.id,
      entries: [],
    });
    await promise;
    await connector.disconnect();
  });

  test('resolves with the parsed entries correlated by requestId', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    const fakeEntries: SessionHistoryEntry[] = [
      {
        kind: 'injection',
        id: MessageId('i-1'),
        sessionId: SessionId('s-1'),
        timestamp: 1,
        content: 'seeded',
      },
    ];
    ws.emitJson({
      type: 'engine.history.response',
      requestId: payload.id,
      entries: fakeEntries,
    });

    const result = await promise;
    expect(result).toEqual(fakeEntries);
    await connector.disconnect();
  });

  test('rejects when the server replies with a non-array entries field', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    ws.emitJson({
      type: 'engine.history.response',
      requestId: payload.id,
      entries: 'not-an-array',
    });

    await expect(promise).rejects.toThrow(/malformed entries/i);
    await connector.disconnect();
  });

  test('routes engine.error to the matching history correlator', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    ws.emitJson({
      type: 'engine.error',
      requestId: payload.id,
      error: 'history backend down',
    });

    await expect(promise).rejects.toThrow('history backend down');
    await connector.disconnect();
  });

  test('rejects with Disconnected when disconnect() lands while a request is in flight', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    await connector.disconnect();
    await expect(promise).rejects.toThrow('Disconnected');
  });

  test('throws when the socket is not connected', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    await expect(connector.getHistory(SessionId('s-1'))).rejects.toThrow(
      'WebSocket not connected',
    );
  });

  test('engine.error with no matching pending request emits a console.warn', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ws.emitJson({
        type: 'engine.error',
        requestId: 'no-such-pending',
        error: 'too late',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        'engine.error with no pending request',
      );
      expect(warnSpy.mock.calls[0][0]).toContain('too late');
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.history.response with a chart-request id does not resolve process()', async () => {
    const connector = new VoiceWebSocketConnector({ url: 'ws://voice' });
    const ws = await connectAndOpen(connector);
    const sharedId = MessageId('voice-collide-1');

    const envelope = buildEnvelope(sharedId);
    const processP = connector.process(envelope);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // engine.history.response routes only via #historyCorrelator; a chart
      // request pending on the same id must not be resolved (mirrors
      // WebSocketConnector — both connectors carry the same dual-correlator
      // design and the same regression risk).
      ws.emitJson({
        type: 'engine.history.response',
        requestId: sharedId,
        entries: [],
      });

      const winner = await Promise.race([
        processP.then(() => 'process-resolved'),
        Promise.resolve('still-pending'),
      ]);
      expect(winner).toBe('still-pending');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'engine.history.response with no pending request',
        ),
      );

      // Settle process() so the test doesn't leak an unhandled rejection.
      ws.emitJson({
        type: 'engine.maelstrom.response',
        sessionId: 'session-voice',
        requestId: sharedId,
        response: {
          type: 'maelstrom_response',
          requestId: sharedId,
          userMessage: 'ok',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });
      await processP;
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });
});
