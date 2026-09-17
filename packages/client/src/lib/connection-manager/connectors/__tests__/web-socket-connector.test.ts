import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { HEARTBEAT_PONG_FRAME } from '@maelstrom-co/connectors';
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
import FakeTimers from '@sinonjs/fake-timers';
import type { ConnectorEvent } from '../../connector.types.js';
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
    const onOpen = mock(
      (send: (data: string) => void, sessionId: SessionId) => {
        send(JSON.stringify({ type: 'test.hello', sessionId }));
      },
    );

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

  test('rejects connect() and closes the socket when onOpen throws', async () => {
    const onOpen = mock(() => {
      throw new Error('onOpen boom');
    });
    const connector = new WebSocketConnector({ url: 'ws://test', onOpen });

    const connectPromise = connector.connect(
      SessionId('session-onopen-throws'),
    );
    await Promise.resolve();
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('FakeWebSocket was not constructed');
    ws.emitOpen();

    await expect(connectPromise).rejects.toThrow('onOpen boom');
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });
});

describe('WebSocketConnector.connect() idempotency', () => {
  test('does not construct a second socket when called again while the first is still connecting', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });

    const first = connector.connect(SessionId('session-1'));
    await Promise.resolve();
    const second = connector.connect(SessionId('session-1'));

    expect(FakeWebSocket.instances).toHaveLength(1);

    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('FakeWebSocket was not constructed');
    ws.emitOpen();

    await first;
    await second;

    expect(FakeWebSocket.instances).toHaveLength(1);
    await connector.disconnect();
  });

  test('does not construct a second socket when called again while already open', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await connectAndOpen(connector);

    expect(FakeWebSocket.instances).toHaveLength(1);

    await connector.connect(SessionId('session-1'));

    expect(FakeWebSocket.instances).toHaveLength(1);
    await connector.disconnect();
  });
});

describe('WebSocketConnector.connect() session scoping', () => {
  test('a DIFFERENT session on an already-open socket dials a fresh socket instead of silently keeping the old session', async () => {
    // Regression: the idempotency guard returned before #sessionId was
    // reassigned, so a second connect() call with a different session on an
    // OPEN socket used to be swallowed as a no-op — #sessionId silently kept
    // its old value instead of moving to the new session, unlike pre-PR
    // behavior where a second call always reassigned it and dialed fresh.
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await connectAndOpen(connector); // session-1
    expect(FakeWebSocket.instances).toHaveLength(1);

    const connectPromise = connector.connect(SessionId('session-2'));
    await Promise.resolve();

    // A genuinely new dial for the new session — not swallowed by the
    // OPEN-socket guard.
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.instances.at(-1);
    if (!ws2) throw new Error('expected a second FakeWebSocket');
    ws2.emitOpen();
    await connectPromise;

    // #sessionId must have actually moved to the new session. Verified via
    // the outbound envelope it stamps — addAssistantMessage is the one
    // place #sessionId is observable from outside the connector.
    await connector.addAssistantMessage({
      id: MessageId('m-1'),
      message: 'hi',
    });
    expect(ws2.sent).toHaveLength(1);
    const decoded = decodeClientEnvelope(ws2.sent[0]);
    expect(isOk(decoded)).toBe(true);
    if (!isOk(decoded)) throw new Error('expected a decodable client envelope');
    if (decoded.value.type !== 'assistant_message') {
      throw new Error('expected assistant_message');
    }
    expect(decoded.value.sessionId).toBe(SessionId('session-2'));

    await connector.disconnect();
  });

  test('the SAME session on an already-open socket remains a true no-op (idempotency preserved)', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await connectAndOpen(connector); // session-1

    await connector.connect(SessionId('session-1'));

    // No second socket constructed for a same-session call.
    expect(FakeWebSocket.instances).toHaveLength(1);
    await connector.disconnect();
  });

  test('a rejecting connect() timeout clears the in-flight promise so a same-session retry dials a fresh socket, not the doomed one', async () => {
    // The idempotency guard's CONNECTING branch only joins #connectPromise
    // while it is still set. connect()'s timeout handler rejects through
    // `attempt.finally(() => { this.#connectPromise = null; })` and nulls
    // `#ws` itself, so a same-session retry after a timeout must fall
    // through both inner checks and dial a genuinely new socket rather than
    // reusing (or hanging off) the timed-out one.
    const clock = FakeTimers.install({ shouldAdvanceTime: true });
    try {
      const connector = new WebSocketConnector({
        url: 'ws://test',
        connectTimeoutMs: 10,
      });

      const first = connector.connect(SessionId('session-1'));
      // Attach the rejection expectation BEFORE advancing the clock: fake
      // timers can settle the rejection across several internal microtask
      // hops, and a promise with no handler attached at that instant gets
      // flagged as an unhandled rejection even though this awaits it
      // moments later.
      const firstRejection = expect(first).rejects.toThrow(/timed out/);
      await clock.tickAsync(10);
      await firstRejection;

      expect(FakeWebSocket.instances).toHaveLength(1);

      const second = connector.connect(SessionId('session-1'));
      await Promise.resolve();
      expect(FakeWebSocket.instances).toHaveLength(2);

      const ws2 = FakeWebSocket.instances.at(-1);
      if (!ws2) throw new Error('expected a second FakeWebSocket');
      ws2.emitOpen();
      await second;

      await connector.disconnect();
    } finally {
      clock.uninstall();
    }
  });

  test('a superseded attempt settling does not clear the live attempt so a same-session retry still joins it', async () => {
    // The in-flight-connect join point is a single field, and a cross-session
    // connect() overwrites it (never idempotent, by contract). If the
    // superseded attempt's settle cleared that field unconditionally it would
    // erase the *live* attempt's join point, so the CONNECTING guard below
    // falls through and constructs a third socket over the live one — the
    // exact double-socket the guard exists to prevent.
    const connector = new WebSocketConnector({ url: 'ws://test' });

    const first = connector.connect(SessionId('session-1'));
    await Promise.resolve();
    const ws1 = FakeWebSocket.instances.at(-1);
    if (!ws1) throw new Error('FakeWebSocket was not constructed');

    // Different session: dials fresh over the still-CONNECTING first socket.
    const second = connector.connect(SessionId('session-2'));
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = FakeWebSocket.instances.at(-1);
    if (!ws2) throw new Error('expected a second FakeWebSocket');

    // The superseded socket finally opens, settling the attempt nobody is
    // waiting on any more.
    ws1.emitOpen();
    await first;

    // The live attempt's socket is still CONNECTING, so this must join it.
    expect(ws2.readyState).toBe(FakeWebSocket.CONNECTING);
    const third = connector.connect(SessionId('session-2'));
    expect(FakeWebSocket.instances).toHaveLength(2);

    ws2.emitOpen();
    await second;
    await third;

    expect(FakeWebSocket.instances).toHaveLength(2);
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

  test('accepts a text-free canonical response without inventing presentation text', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);
    const envelope = buildEnvelope(MessageId('text-free'));
    const pending = connector.process(envelope);

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'engine.maelstrom.response',
        requestId: envelope.id,
        response: {
          type: 'maelstrom_response',
          requestId: envelope.id,
          executionPlan: [],
          layout: { type: 'grid', positions: [] },
        },
      }),
    });

    const response = await pending;
    expect(response.userMessage).toBeUndefined();
    expect(response.rationale).toBeUndefined();
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

  describe('addAssistantMessageAcknowledged', () => {
    test('sends client.assistant_message.acknowledged and resolves inserted', async () => {
      const connector = new WebSocketConnector({ url: 'ws://test' });
      const ws = await connectAndOpen(connector);
      const promise = connector.addAssistantMessageAcknowledged({
        id: MessageId('a-1'),
        message: 'hello',
      });

      expect(ws.sent).toHaveLength(1);
      const decoded = decodeClientEnvelope(ws.sent[0]);
      expect(isOk(decoded)).toBe(true);
      if (
        !isOk(decoded) ||
        decoded.value.type !== 'client.assistant_message.acknowledged'
      ) {
        throw new Error('expected client.assistant_message.acknowledged');
      }
      expect(decoded.value).toMatchObject({
        id: MessageId('a-1'),
        content: 'hello',
        sessionId: SessionId('session-1'),
      });

      ws.emitJson({
        type: 'engine.assistant_message.result',
        requestId: MessageId('a-1'),
        sessionId: SessionId('session-1'),
        outcome: 'inserted',
      });
      await expect(promise).resolves.toBe('inserted');
      await connector.disconnect();
    });

    test('resolves deduped', async () => {
      const connector = new WebSocketConnector({ url: 'ws://test' });
      const ws = await connectAndOpen(connector);
      const promise = connector.addAssistantMessageAcknowledged({
        id: MessageId('a-1'),
        message: 'hello',
      });
      ws.emitJson({
        type: 'engine.assistant_message.result',
        requestId: MessageId('a-1'),
        sessionId: SessionId('session-1'),
        outcome: 'deduped',
      });
      await expect(promise).resolves.toBe('deduped');
      await connector.disconnect();
    });

    test.each([
      ['invalid_envelope', 'invalid envelope'],
      ['UnsupportedMessageType', 'unsupported message type'],
    ])('rejects an old server %s engine.error instead of treating it as an acknowledgement', async (code, error) => {
      const connector = new WebSocketConnector({ url: 'ws://test' });
      const ws = await connectAndOpen(connector);
      const promise = connector.addAssistantMessageAcknowledged({
        id: MessageId('a-1'),
        message: 'hello',
      });
      emitServer(
        ws,
        EngineErrorMessage({
          requestId: MessageId('a-1'),
          error,
          code,
        }),
      );
      await expect(promise).rejects.toMatchObject({
        name: 'WireEngineError',
        message: error,
        code,
      });
      await connector.disconnect();
    });

    test('rejects on close', async () => {
      const connector = new WebSocketConnector({ url: 'ws://test' });
      const ws = await connectAndOpen(connector);
      const promise = connector.addAssistantMessageAcknowledged({
        id: MessageId('a-1'),
        message: 'hello',
      });
      ws.emitClose(1000);
      await expect(promise).rejects.toThrow('WebSocket closed');
    });

    test('rejects after the bounded timeout when an old server stays silent', async () => {
      const clock = FakeTimers.install({ shouldAdvanceTime: true });
      try {
        const connector = new WebSocketConnector({
          url: 'ws://test',
          timeout: 20,
        });
        await connectAndOpen(connector);
        const promise = connector.addAssistantMessageAcknowledged({
          id: MessageId('a-1'),
          message: 'hello',
        });
        const rejection = expect(promise).rejects.toThrow(/timed out/i);
        await clock.tickAsync(20);
        await rejection;
        await connector.disconnect();
      } finally {
        clock.uninstall();
      }
    });

    test('rejects when WebSocket send throws', async () => {
      const connector = new WebSocketConnector({ url: 'ws://test' });
      const ws = await connectAndOpen(connector);
      const sendError = new Error('send failed');
      ws.send = () => {
        throw sendError;
      };

      await expect(
        connector.addAssistantMessageAcknowledged({
          id: MessageId('a-send-fail'),
          message: 'hello',
        }),
      ).rejects.toBe(sendError);

      await connector.disconnect();
    });

    test('throws when not connected', async () => {
      const connector = new WebSocketConnector({ url: 'ws://test' });
      await expect(
        connector.addAssistantMessageAcknowledged({
          id: MessageId('a-1'),
          message: 'hello',
        }),
      ).rejects.toThrow('WebSocket not connected');
    });
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

describe('WebSocketConnector heartbeatIntervalMs validation', () => {
  // heartbeatIntervalMs is exported public API (WebSocketConnectorOptions),
  // and setInterval coerces 0/negative/NaN to an effectively-immediate timer
  // and never fires at all for Infinity. No current caller can hit this —
  // the only call site hardcodes 30_000 or undefined — but an external
  // consumer could, so the constructor rejects it outright rather than
  // flooding pings at the server or silently never sending any.
  test.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('throws when heartbeatIntervalMs is %p', (value) => {
    expect(
      () =>
        new WebSocketConnector({
          url: 'ws://test',
          heartbeatIntervalMs: value,
        }),
    ).toThrow(/heartbeatIntervalMs/);
  });

  test('accepts a valid positive heartbeatIntervalMs', () => {
    expect(
      () =>
        new WebSocketConnector({
          url: 'ws://test',
          heartbeatIntervalMs: 30_000,
        }),
    ).not.toThrow();
  });

  test('leaves heartbeatIntervalMs disabled when omitted (undefined remains valid)', () => {
    expect(() => new WebSocketConnector({ url: 'ws://test' })).not.toThrow();
  });
});

describe('WebSocketConnector heartbeat', () => {
  // Real setTimeout-based waits here would race the heartbeat interval under
  // CI load (a slow tick could easily fall short of 2 pings in 35ms). Fake
  // timers make the elapsed time exact regardless of how the host machine is
  // scheduling this process, mirroring connection-manager.test.ts's own
  // FakeTimers usage.
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('sends a frame every heartbeatIntervalMs while connected', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      heartbeatIntervalMs: 10,
    });
    const ws = await connectAndOpen(connector);

    await clock.tickAsync(35);
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
    await clock.tickAsync(35);
    expect(ws.sent.length).toBe(countAtDisconnect);
  });

  test('does not start a heartbeat timer when heartbeatIntervalMs is omitted', async () => {
    // No assertion beyond "doesn't throw" — omission must be a true no-op.
    const connector = new WebSocketConnector({ url: 'ws://test' });
    await connectAndOpen(connector);
    await connector.disconnect();
  });

  test('swallows a heartbeat.pong frame silently when heartbeat is enabled', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      heartbeatIntervalMs: 10_000,
    });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Must never reach decodeServerEnvelope: a pong is demo-layer and would
      // otherwise be logged as an undecodable frame every heartbeat tick.
      ws.emitJson({ type: 'heartbeat.pong' });

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('a heartbeat.pong frame follows the normal (undecodable-frame) path when heartbeat is disabled', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ws.emitJson({ type: 'heartbeat.pong' });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain(
        '[WebSocketConnector] undecodable frame',
      );
    } finally {
      warnSpy.mockRestore();
      await connector.disconnect();
    }
  });

  test('normal envelopes still flow when heartbeat is enabled', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      heartbeatIntervalMs: 10_000,
    });
    const ws = await connectAndOpen(connector);

    const envelope = buildEnvelope(MessageId('heartbeat-coexist-1'));
    const promise = connector.process(envelope);

    emitServer(
      ws,
      MaelstromResponseMessage({
        requestId: envelope.id,
        response: buildResponse(envelope.id, { userMessage: 'ok' }),
      }),
    );

    const response = await promise;
    expect(response.userMessage).toBe('ok');
    await connector.disconnect();
  });
});

describe('WebSocketConnector heartbeat liveness', () => {
  // The 45ms/60ms budgets below are tight enough relative to the 10ms/2ms
  // intervals involved that a real timer would flake under CI load — a
  // single delayed tick either side is enough to send one ping too few/many
  // or miss the OPEN/CLOSED window entirely. Fake timers make every
  // interval fire at the exact virtual millisecond it's scheduled for.
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('closes the socket after consecutive pings go unanswered (half-open tunnel detection)', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      heartbeatIntervalMs: 10,
    });
    const ws = await connectAndOpen(connector);

    // No pongs are ever delivered — this is the exact failure the heartbeat
    // exists to catch: a tunnel that dies without a TCP FIN reaching the
    // browser (a Cloudflare edge drop, a vanished container). readyState
    // stays OPEN and no onclose fires on its own, so nothing but an active
    // liveness check can notice.
    await clock.tickAsync(45);

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);

    const heartbeats = ws.sent.filter(
      (s) => typeof s === 'string' && JSON.parse(s).type === 'heartbeat.ping',
    );
    // Exactly MAX_MISSED_HEARTBEATS (2) unanswered pings are sent before the
    // connector gives up and closes rather than pinging into the void
    // forever.
    expect(heartbeats.length).toBe(2);

    await connector.disconnect();
  });

  test('a pong resets the missed-heartbeat counter, so a link that keeps answering is never closed', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://test',
      heartbeatIntervalMs: 10,
    });
    const ws = await connectAndOpen(connector);

    // Answer every ping as it arrives. If the counter didn't reset on a
    // pong, this connection would still be closed after ~30ms (the same
    // logic as the previous test) — running well past that with the socket
    // still OPEN proves the reset actually happens.
    let answered = 0;
    const responder = setInterval(() => {
      while (answered < ws.sent.length) {
        ws.emitJson({ type: 'heartbeat.pong' });
        answered++;
      }
    }, 2);

    await clock.tickAsync(60);
    clearInterval(responder);

    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    const heartbeats = ws.sent.filter(
      (s) => typeof s === 'string' && JSON.parse(s).type === 'heartbeat.ping',
    );
    expect(heartbeats.length).toBeGreaterThanOrEqual(4);

    await connector.disconnect();
  });
});

describe('WebSocketConnector superseded-socket close guard', () => {
  test('a close event from a socket the connector has already replaced does not stop the live socket heartbeat or reject its pending requests', async () => {
    // Fake timers here (rather than the real 25ms wait this used to run):
    // that budget is only 2.5x the 10ms heartbeat interval, tight enough to
    // occasionally send zero pings under CI load and fail the
    // toBeGreaterThanOrEqual(1) assertion below for a reason that has
    // nothing to do with the guard this test exists to cover.
    const clock = FakeTimers.install({ shouldAdvanceTime: true });
    try {
      const connector = new WebSocketConnector({
        url: 'ws://test',
        heartbeatIntervalMs: 10,
      });

      // First connect — models the socket a disposed Orchestrator instance
      // leaves behind (e.g. React StrictMode's dev double-mount sharing a
      // memoized connector between a disposed and replacement instance).
      const staleConnectPromise = connector.connect(SessionId('session-1'));
      await Promise.resolve();
      const staleWs = FakeWebSocket.instances.at(-1);
      if (!staleWs) throw new Error('stale FakeWebSocket was not constructed');
      staleWs.emitOpen();
      await staleConnectPromise;

      // Reconnect on the same connector — disconnect() nulls `#ws`
      // synchronously (mirroring the real Orchestrator dispose()/connect()
      // sequence a StrictMode double-mount produces), so the follow-up
      // connect() below builds a genuinely new socket rather than being a
      // no-op against the idempotency guard. The stale socket's onclose
      // handler (closed over `staleWs`, not read back through `this.#ws`)
      // is still registered, though — that's the guard this test exercises.
      await connector.disconnect();
      const liveWs = await connectAndOpen(connector);

      const events: ConnectorEvent[] = [];
      connector.subscribe((e) => events.push(e));

      const envelope = buildEnvelope(MessageId('live-pending'));
      const pending = connector.process(envelope);

      // The superseded socket's close event arrives late.
      staleWs.emitClose(1006, '');

      expect(events).toHaveLength(0);

      // The live socket's heartbeat must still be running — a superseded
      // socket's close must not be able to clear it.
      await clock.tickAsync(25);
      const heartbeats = liveWs.sent.filter(
        (s) => typeof s === 'string' && JSON.parse(s).type === 'heartbeat.ping',
      );
      expect(heartbeats.length).toBeGreaterThanOrEqual(1);

      // The live socket's pending request must not have been rejected either.
      emitServer(
        liveWs,
        MaelstromResponseMessage({
          requestId: envelope.id,
          response: buildResponse(envelope.id, { userMessage: 'still alive' }),
        }),
      );
      const response = await pending;
      expect(response.userMessage).toBe('still alive');

      await connector.disconnect();
    } finally {
      clock.uninstall();
    }
  });
});

describe('WebSocketConnector disconnected retryable flag', () => {
  test('a close code 1008 (policy violation) is reported as non-retryable', async () => {
    // RFC 6455: 1008 means the server is deliberately rejecting this client.
    // ws-server.ts uses it both for a rejected handshake and for an evicted
    // session — in both cases reconnecting with the same session id would
    // just be rejected again, so ConnectionManager must not auto-reconnect.
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);
    const events: ConnectorEvent[] = [];
    connector.subscribe((e) => events.push(e));

    ws.emitClose(1008, 'session evicted');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'disconnected',
      clean: false,
      message: 'session evicted',
      retryable: false,
    });
  });

  test('an abnormal closure (e.g. 1006, proxy/container drop) leaves retryable unset so auto-reconnect still applies', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);
    const events: ConnectorEvent[] = [];
    connector.subscribe((e) => events.push(e));

    ws.emitClose(1006, '');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'disconnected', clean: false });
    expect((events[0] as { retryable?: boolean }).retryable).toBeUndefined();
  });

  test('a clean close (code 1000) leaves retryable unset (clean already prevents auto-reconnect)', async () => {
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);
    const events: ConnectorEvent[] = [];
    connector.subscribe((e) => events.push(e));

    ws.emitClose(1000, 'bye');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'disconnected', clean: true });
    expect((events[0] as { retryable?: boolean }).retryable).toBeUndefined();
  });
});

describe('WebSocketConnector disconnect() close notification', () => {
  test("a belated close event from disconnect()'s own socket still reaches subscribers as a clean disconnect", async () => {
    // Regression coverage for a stale-close guard that compared against
    // `#ws` identity: disconnect() nulls `#ws` synchronously, before the
    // browser's real close event for that same socket fires, so comparing
    // against `#ws` swallowed every manual disconnect's notification too —
    // not just a genuinely superseded socket's belated close (the case the
    // "superseded-socket close guard" suite above covers).
    const connector = new WebSocketConnector({ url: 'ws://test' });
    const ws = await connectAndOpen(connector);

    const events: ConnectorEvent[] = [];
    connector.subscribe((e) => events.push(e));

    await connector.disconnect();
    // `clean: true` below is only meaningful if disconnect() actually asks
    // for 1000: a bare close() would have the browser report 1005, and this
    // test would be asserting a clean disconnect that production never
    // produces. emitClose() fabricates whatever code it's given, so the
    // request has to be checked separately from the reply.
    expect(ws.closeCodes).toEqual([1000]);
    // The real WebSocket API fires `close` asynchronously after `.close()`
    // is called — FakeWebSocket mirrors that gap by requiring an explicit
    // emitClose() rather than firing it inside close() itself.
    ws.emitClose(1000, 'client disconnect');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'disconnected', clean: true });
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

describe('onFrame inbound hook', () => {
  test('consumes a frame when it returns true, so it never reaches the decode path', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    const connector = new WebSocketConnector({
      url: 'ws://localhost/ws',
      onFrame: (raw, send, sessionId) => {
        seen.push(raw);
        send(JSON.stringify({ type: 'demo.ack', sessionId }));
        return true;
      },
    });
    const connecting = connector.connect(SessionId('s-1'));
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emitOpen();
    await connecting;

    ws.onmessage?.({ data: JSON.stringify({ type: 'demo.custom' }) });

    expect(seen).toEqual([JSON.stringify({ type: 'demo.custom' })]);
    // The hook's own reply went out...
    expect(ws.sent).toContain(
      JSON.stringify({ type: 'demo.ack', sessionId: 's-1' }),
    );
    // ...and the frame never reached decodeServerEnvelope, which would have
    // warned about an undecodable envelope. That warning is the observable
    // proof the frame was actually consumed rather than merely copied.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('replies over the socket that delivered the frame, as the session it was opened for', async () => {
    const connector = new WebSocketConnector({
      url: 'ws://localhost/ws',
      onFrame: (_raw, send, sessionId) => {
        send(JSON.stringify({ type: 'demo.ack', sessionId }));
        return true;
      },
    });
    const connecting = connector.connect(SessionId('s-1'));
    const first = FakeWebSocket.instances.at(-1)!;
    first.emitOpen();
    await connecting;

    // A reconnect supersedes the socket, and does so under a DIFFERENT
    // session — so this covers both captured values at once. disconnect()
    // nulls `#ws` synchronously (mirroring the real Orchestrator dispose()/
    // connect() sequence a StrictMode double-mount produces) before the
    // follow-up connect() builds the replacement — otherwise it would be a
    // no-op against the idempotency guard instead of a real reconnect. The
    // old socket can still deliver a frame that was already in flight,
    // which is why `onclose` guards against the same hazard.
    await connector.disconnect();
    const reconnecting = connector.connect(SessionId('s-2'));
    const second = FakeWebSocket.instances.at(-1)!;
    second.emitOpen();
    await reconnecting;
    expect(second).not.toBe(first);
    const secondBefore = second.sent.length;

    first.emitJson({ type: 'demo.custom' });

    // Right socket AND right session. Routing the answer to the replacement
    // socket would leave the ASKING socket waiting forever while the new one
    // fields a response to a question it never asked. Answering over the
    // correct socket but stamping it with the newer session id is the
    // subtler half of the same bug: for the demo's rehello handshake that
    // re-keys this connection to a session it does not belong to, so the
    // server files its engine and history under the wrong identity.
    expect(first.sent).toContain(
      JSON.stringify({ type: 'demo.ack', sessionId: 's-1' }),
    );
    expect(first.sent).not.toContain(
      JSON.stringify({ type: 'demo.ack', sessionId: 's-2' }),
    );
    expect(second.sent.length).toBe(secondBefore);

    await connector.disconnect();
  });

  test('survives a throwing hook and still decodes the frame', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const connector = new WebSocketConnector({
      url: 'ws://localhost/ws',
      onFrame: () => {
        throw new Error('consumer hook blew up');
      },
    });
    const connecting = connector.connect(SessionId('s-4'));
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emitOpen();
    await connecting;

    // A consumer hook is arbitrary code. If it can throw out of onmessage,
    // one bad hook turns every inbound frame into an unhandled rejection AND
    // skips envelope decoding entirely — the connector silently stops
    // delivering protocol traffic it was perfectly able to handle.
    expect(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: 'not-an-envelope' }) });
    }).not.toThrow();

    // Proof the frame still reached the codec: an undecodable envelope warns.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await connector.disconnect();
  });

  test('falls through to the decode path when it returns false', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const connector = new WebSocketConnector({
      url: 'ws://localhost/ws',
      onFrame: () => false,
    });
    connector.connect(SessionId('s-2'));
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emitOpen();

    ws.onmessage?.({ data: JSON.stringify({ type: 'not-an-envelope' }) });

    // Declining the frame must leave existing behavior byte-identical —
    // otherwise the hook silently swallows traffic a consumer chose not to
    // handle.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('does not intercept heartbeat pongs', async () => {
    const seen: string[] = [];
    const connector = new WebSocketConnector({
      url: 'ws://localhost/ws',
      heartbeatIntervalMs: 30_000,
      onFrame: (raw) => {
        seen.push(raw);
        return true;
      },
    });
    const connecting = connector.connect(SessionId('s-3'));
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.emitOpen();
    await connecting;

    ws.onmessage?.({ data: HEARTBEAT_PONG_FRAME });

    // The pong is transport-level bookkeeping the connector owns. Handing it
    // to a consumer hook would let a consumer accidentally break liveness
    // detection by consuming it.
    expect(seen).toEqual([]);
  });
});
