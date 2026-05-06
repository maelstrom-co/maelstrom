import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { InstanceId, MessageId, SessionId } from '@maelstrom-co/protocol';

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

describe('WebSocketConnector silent-failure hygiene', () => {
  test('parse failure logs the bound error and the raw event data', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Deliver a non-JSON payload through onmessage directly so JSON.parse
      // throws inside #handleMessage. Bypasses emitJson which JSON-encodes.
      ws.onmessage?.({ data: '{not-json' });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const callArgs = errorSpy.mock.calls[0];
      expect(callArgs[0]).toContain(
        '[WebSocketConnector] Failed to parse message',
      );
      expect(callArgs[1]).toBeInstanceOf(Error); // bound parse exception
      expect(callArgs[2]).toBe('{not-json'); // raw event.data preserved
    } finally {
      errorSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('unmatched engine.maelstrom.response emits a console.warn', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // No outstanding process() call → no pending request for this id.
      ws.emitJson({
        type: 'engine.maelstrom.response',
        requestId: 'no-such-pending',
        response: {
          type: 'maelstrom_response',
          requestId: 'no-such-pending',
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        '[WebSocketConnector] engine.maelstrom.response with no pending request',
      );
      expect(warnSpy.mock.calls[0][0]).toContain('no-such-pending');
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.maelstrom.response with empty-string requestId does not call resolve', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    // No console.warn for unmatched-response should fire either, because we
    // never reach #correlator.resolve at all when the guard rejects the id.
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ws.emitJson({
        type: 'engine.maelstrom.response',
        requestId: '',
        response: {
          type: 'maelstrom_response',
          requestId: '',
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.maelstrom.response with non-string requestId is ignored', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

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
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.error with empty-string requestId does not reject pending requests', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('valid-pending'));
    const promise = connector.process(envelope);

    // Malformed engine.error frame: empty requestId. The isCorrelatableId
    // guard at the engine.error site must reject this so it does NOT call
    // correlator.reject (which could otherwise misroute or mis-trigger).
    ws.emitJson({
      type: 'engine.error',
      requestId: '',
      error: 'should not propagate',
    });

    // Pending request remains unaffected — we then resolve it normally.
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
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('valid-pending-2'));
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

describe('WebSocketConnector getHistory', () => {
  test('sends client.history.get with the supplied sessionId and a generated request id', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
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

    // Settle the outstanding promise before disconnect so it doesn't surface
    // as an unhandled rejection.
    ws.emitJson({
      type: 'engine.history.response',
      requestId: payload.id,
      entries: [],
    });
    await promise;
    await connector.disconnect();
  });

  test('resolves with the entries array correlated by requestId', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    const fakeEntries = [
      {
        kind: 'injection',
        id: 'i-1',
        sessionId: 's-1',
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
    expect(result).toEqual(fakeEntries as never);
    await connector.disconnect();
  });

  test('rejects when the server replies with a non-array entries field', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    // Schema rejection at the wire boundary surfaces server contract
    // violations to the caller instead of silently coercing to [].
    ws.emitJson({
      type: 'engine.history.response',
      requestId: payload.id,
      entries: 'not-an-array',
    });

    await expect(promise).rejects.toThrow(/malformed entries/i);
    await connector.disconnect();
  });

  test('rejects when an entry has a non-finite timestamp', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    // NaN timestamps would silently corrupt sort order on the client; the
    // schema's finite-number refinement must reject them at ingress.
    ws.emitJson({
      type: 'engine.history.response',
      requestId: payload.id,
      entries: [
        {
          kind: 'injection',
          id: 'i-1',
          sessionId: 's-1',
          timestamp: Number.NaN,
          content: 'seeded',
        },
      ],
    });

    await expect(promise).rejects.toThrow(/malformed entries/i);
    await connector.disconnect();
  });

  test('routes engine.error to the matching history correlator', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
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
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    await connector.disconnect();
    await expect(promise).rejects.toThrow('Disconnected');
  });

  test('throws when the socket is not connected', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await expect(connector.getHistory(SessionId('s-1'))).rejects.toThrow(
      'WebSocket not connected',
    );
  });
});

describe('WebSocketConnector cross-correlator isolation', () => {
  test('engine.history.response with a chart-request id does not resolve process()', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);
    const sharedId = MessageId('collide-1');

    const envelope = buildEnvelope(sharedId);
    const processP = connector.process(envelope);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // engine.history.response routes only via #historyCorrelator; a chart
      // request pending on the same id must not be resolved.
      ws.emitJson({
        type: 'engine.history.response',
        requestId: sharedId,
        entries: [],
      });

      // process() must remain pending — race against an already-resolved
      // sentinel to detect a wrongful resolution without waiting for a
      // timeout.
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

  test('engine.error with no matching pending request emits a console.warn', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Most likely real-world cause: post-timeout server failure delivery.
      // Both correlators miss; the warn keeps the diagnostic from being
      // silently swallowed.
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
});
