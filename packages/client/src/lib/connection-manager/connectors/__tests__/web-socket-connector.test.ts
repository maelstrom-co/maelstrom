import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import {
  ActionName,
  decodeClientEnvelope,
  EngineErrorMessage,
  EnvelopeError,
  encodeEnvelope,
  HistoryResponseMessage,
  InstanceId,
  isOk,
  type MaelstromResponse,
  MaelstromResponseMessage,
  MessageId,
  type ServerEnvelope,
  type SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';

import { WireEngineError } from '../../connector.types.js';
import { WebSocketConnector } from '../web-socket-connector.js';
import { buildEnvelope, connectAndOpen } from './connector-test-helpers.js';
import { FakeWebSocket, installFakeWebSocket } from './fake-websocket.js';

let teardown: (() => void) | null = null;

beforeEach(() => {
  teardown = installFakeWebSocket();
});

afterEach(() => {
  teardown?.();
  teardown = null;
});

/**
 * Deliver a real ServerEnvelope through the same codec the wire uses: the
 * frame is built with protocol's smart constructor and serialized with
 * `encodeEnvelope`, so every emit doubles as a cross-package conformance check
 * that the connector decodes exactly what a host encodes.
 */
const emitServer = (ws: FakeWebSocket, env: ServerEnvelope): void => {
  ws.onmessage?.({ data: encodeEnvelope(env) });
};

const buildResponse = (
  requestId: MessageId,
  overrides: Partial<MaelstromResponse> = {},
): MaelstromResponse => ({
  type: 'maelstrom_response',
  requestId,
  userMessage: '',
  rationale: '',
  executionPlan: [],
  layout: { type: 'grid', positions: [] },
  ...overrides,
});

describe('WebSocketConnector onOpen hook', () => {
  test('invokes onOpen with a send function and the connecting sessionId before connect() resolves', async () => {
    const sent: string[] = [];
    const onOpen = mock((send: (data: string) => void, sessionId: SessionId) => {
      send(JSON.stringify({ type: 'test.hello', sessionId }));
    });

    const connector = new WebSocketConnector({ url: 'ws://test', onOpen });

    const connectPromise = connector.connect(SessionId('session-onopen-test'));
    await Promise.resolve();
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('FakeWebSocket was not constructed');
    ws.emitOpen();
    if (typeof ws.sent[0] === 'string') sent.push(ws.sent[0]);
    await connectPromise;

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0] as string)).toMatchObject({
      type: 'test.hello',
      sessionId: 'session-onopen-test',
    });

    await connector.disconnect();
  });

  test('does not require onOpen to be provided (default WebSocketConnectorOptions unaffected)', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await connectAndOpen(connector);
    await connector.disconnect();
  });
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

    emitServer(
      ws,
      MaelstromResponseMessage({
        requestId: envelope.id,
        response: buildResponse(envelope.id),
      }),
    );
    await promise;
    await connector.disconnect();
  });

  test('resolves process() when a response with matching requestId arrives', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('round-trip-2'));
    const promise = connector.process(envelope);

    emitServer(
      ws,
      MaelstromResponseMessage({
        requestId: envelope.id,
        response: buildResponse(envelope.id, {
          userMessage: 'ok',
          executionPlan: [
            { instanceId: InstanceId('i-1'), action: ActionName('noop') },
          ],
        }),
      }),
    );

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

    emitServer(
      ws,
      EngineErrorMessage({
        requestId: envelope.id,
        error: 'envelope rejected',
      }),
    );

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

describe('WebSocketConnector assistant message', () => {
  test('sends a decodable assistant_message with an epoch-scale timestamp', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    await connector.addAssistantMessage({
      id: MessageId('a-1'),
      message: 'hello there',
    });

    expect(ws.sent).toHaveLength(1);
    // Round-trip through the real client codec, not a string comparison: the
    // connector must emit a frame a host can decode as assistant_message.
    const decoded = decodeClientEnvelope(ws.sent[0]);
    expect(isOk(decoded)).toBe(true);
    if (!isOk(decoded)) throw new Error('expected a decodable client envelope');
    const value = decoded.value;
    expect(value.type).toBe('assistant_message');
    if (value.type !== 'assistant_message') {
      throw new Error('expected assistant_message');
    }
    expect(value.content).toBe('hello there');
    expect(value.id).toBe(MessageId('a-1'));
    expect(value.sessionId).toBe(SessionId('session-1'));
    // Pins the performance.now() → Date.now() fix: a wall-clock epoch is well
    // past 1e12ms, a performance.now() offset (ms since page origin) is not.
    expect(value.timestamp).toBeGreaterThan(1e12);
    await connector.disconnect();
  });
});

describe('WebSocketConnector silent-failure hygiene', () => {
  test('undecodable non-JSON frame with no recoverable id warns', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Deliver a non-JSON payload directly through onmessage. The codec owns
      // parse failure now; with no recoverable requestId the frame is warned,
      // not silently trusted.
      ws.onmessage?.({ data: '{not-json' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        '[WebSocketConnector] undecodable frame',
      );
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('malformed engine.maelstrom.response rejects the pending process()', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('malformed-response'));
    const promise = connector.process(envelope);

    // Valid requestId, but the response is missing executionPlan → the codec
    // rejects it. The pending request must fail with the EnvelopeError instead
    // of stranding until timeout.
    ws.emitJson({
      type: 'engine.maelstrom.response',
      requestId: envelope.id,
      response: {
        type: 'maelstrom_response',
        requestId: envelope.id,
        userMessage: '',
        rationale: '',
        layout: { type: 'grid', positions: [] },
        // executionPlan intentionally omitted
      },
    });

    let caught: unknown;
    await promise.catch((error: unknown) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(EnvelopeError);
    expect((caught as Error).message).toMatch(/executionPlan/i);
    await connector.disconnect();
  });

  test('unmatched engine.maelstrom.response emits a console.warn', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // No outstanding process() call → no pending request for this id.
      emitServer(
        ws,
        MaelstromResponseMessage({
          requestId: MessageId('no-such-pending'),
          response: buildResponse(MessageId('no-such-pending')),
        }),
      );

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

  test('response frame with an empty requestId is unrecoverable and warns', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('intact-1'));
    const promise = connector.process(envelope);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Empty requestId fails the codec's MessageId schema, and recovery skips
      // it (nothing correlates to an empty id) — so the frame is warned and no
      // pending request is touched.
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

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        '[WebSocketConnector] undecodable frame',
      );

      // The unrelated pending request still resolves normally.
      emitServer(
        ws,
        MaelstromResponseMessage({
          requestId: envelope.id,
          response: buildResponse(envelope.id, { userMessage: 'ok' }),
        }),
      );
      const response = await promise;
      expect(response.userMessage).toBe('ok');
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('engine.error with a non-string requestId does not reject pending requests', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('intact-2'));
    const promise = connector.process(envelope);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Wire delivers a number requestId — fails the codec and is unrecoverable
      // (not a string), so the pending request is left untouched.
      ws.emitJson({
        type: 'engine.error',
        requestId: 42 as unknown as string,
        error: 'should not propagate',
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        '[WebSocketConnector] undecodable frame',
      );

      emitServer(
        ws,
        MaelstromResponseMessage({
          requestId: envelope.id,
          response: buildResponse(envelope.id, { userMessage: 'ok' }),
        }),
      );
      const response = await promise;
      expect(response.userMessage).toBe('ok');
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });
});

describe('WebSocketConnector engine.error', () => {
  test('rejects with a WireEngineError carrying the wire code', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('coded-1'));
    const promise = connector.process(envelope);

    emitServer(
      ws,
      EngineErrorMessage({
        requestId: envelope.id,
        error: 'history not configured',
        code: 'HistoryNotConfigured',
      }),
    );

    let caught: unknown;
    await promise.catch((error: unknown) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(WireEngineError);
    expect((caught as WireEngineError).code).toBe('HistoryNotConfigured');
    expect((caught as Error).message).toBe('history not configured');
    await connector.disconnect();
  });

  test('without a requestId warns and rejects no pending request', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('untouched-1'));
    const promise = connector.process(envelope);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A stream-level fault the host could not correlate — requestId omitted.
      emitServer(ws, EngineErrorMessage({ error: 'stream fault' }));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        '[WebSocketConnector] engine.error with no requestId',
      );

      // Pending request is unaffected and resolves normally.
      emitServer(
        ws,
        MaelstromResponseMessage({
          requestId: envelope.id,
          response: buildResponse(envelope.id, { userMessage: 'ok' }),
        }),
      );
      const response = await promise;
      expect(response.userMessage).toBe('ok');
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('with no matching pending request emits a console.warn', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Most likely real-world cause: post-timeout server failure delivery.
      // Both correlators miss; the warn keeps the diagnostic from being
      // silently swallowed.
      emitServer(
        ws,
        EngineErrorMessage({
          requestId: MessageId('no-such-pending'),
          error: 'too late',
        }),
      );

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
    emitServer(
      ws,
      HistoryResponseMessage({ requestId: MessageId(payload.id), entries: [] }),
    );
    await promise;
    await connector.disconnect();
  });

  test('resolves with the entries array correlated by requestId', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
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
    emitServer(
      ws,
      HistoryResponseMessage({
        requestId: MessageId(payload.id),
        entries: fakeEntries,
      }),
    );

    const result = await promise;
    expect(result).toEqual(fakeEntries);
    await connector.disconnect();
  });

  test('rejects when the server replies with a non-array entries field', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    // Intentionally malformed — hand-built so it bypasses the constructor. The
    // codec rejects it at the boundary and the recovered requestId fails the
    // awaiting caller instead of silently coercing to [].
    ws.emitJson({
      type: 'engine.history.response',
      requestId: payload.id,
      entries: 'not-an-array',
    });

    let caught: unknown;
    await promise.catch((error: unknown) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(EnvelopeError);
    expect((caught as Error).message).toMatch(/entries/i);
    await connector.disconnect();
  });

  test('rejects when an entry has a non-finite timestamp', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    // NaN timestamps would silently corrupt sort order on the client; the
    // schema's finite-number refinement must reject them at ingress (NaN
    // serializes to null, which is likewise rejected).
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

    let caught: unknown;
    await promise.catch((error: unknown) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(EnvelopeError);
    expect((caught as Error).message).toMatch(/timestamp/i);
    await connector.disconnect();
  });

  test('routes engine.error to the matching history correlator', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const promise = connector.getHistory(SessionId('s-1'));
    const payload = JSON.parse(ws.sent[0] as string) as { id: string };

    emitServer(
      ws,
      EngineErrorMessage({
        requestId: MessageId(payload.id),
        error: 'history backend down',
      }),
    );

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

describe('WebSocketConnector heartbeat', () => {
  test('sends a frame every heartbeatIntervalMs while connected', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      heartbeatIntervalMs: 10,
    });
    const ws = await connectAndOpen(connector);

    await new Promise((resolve) => setTimeout(resolve, 35));
    await connector.disconnect();

    const heartbeats = ws.sent.filter(
      (s) => typeof s === 'string' && JSON.parse(s).type === 'heartbeat.ping',
    );
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
  });

  test('stops sending heartbeats after disconnect', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      heartbeatIntervalMs: 10,
    });
    const ws = await connectAndOpen(connector);
    await connector.disconnect();
    const countAtDisconnect = ws.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(ws.sent.length).toBe(countAtDisconnect);
  });

  test('does not start a heartbeat timer when heartbeatIntervalMs is omitted', async () => {
    // No assertion beyond "doesn't throw" — omission must be a true no-op.
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await connectAndOpen(connector);
    await connector.disconnect();
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
      emitServer(
        ws,
        HistoryResponseMessage({ requestId: sharedId, entries: [] }),
      );

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
      emitServer(
        ws,
        MaelstromResponseMessage({
          requestId: sharedId,
          response: buildResponse(sharedId, { userMessage: 'ok' }),
        }),
      );
      await processP;
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });
});
