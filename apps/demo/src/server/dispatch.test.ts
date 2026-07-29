import { HEARTBEAT_PING_FRAME } from '@maelstrom-co/client';
import {
  ChartRequestMessage,
  encodeEnvelope,
  SessionId,
} from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { dispatchFrame } from './dispatch';

const chartRequest = encodeEnvelope(
  ChartRequestMessage({
    sessionId: SessionId('s-1'),
    request: {
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'hi' }],
        chartDimensions: { rows: 8, columns: 12 },
        layoutMode: 'grid',
      },
      instances: [],
      vessels: [],
      layout: { type: 'grid', positions: [] },
    },
  }),
);

const hello = JSON.stringify({
  type: 'playground.hello',
  sessionId: 's-1',
  apiKey: 'sk-0123456789012345678901234567890123456789',
});

const base = {
  helloReceived: false,
  getEngine: () => null,
  wasHelloed: false,
  engineUnavailableReason: 'session engine unavailable',
};

describe('dispatchFrame', () => {
  it('classifies a heartbeat before the hello gate', async () => {
    // A keyless visitor never sends playground.hello, but the client's
    // heartbeat timer still fires. If the hello gate ran first, that ping
    // would be judged the "first frame" and close the socket on a visitor
    // who was only waiting to be prompted for a key.
    const result = await dispatchFrame(HEARTBEAT_PING_FRAME, base);
    expect(result.kind).toBe('heartbeat');
  });

  it('returns rehello when a helloed connection has lost its key', async () => {
    // This is the hibernation wake: the attachment marker survived, the
    // in-memory key did not. Answering with the keyless-visitor error here
    // would tell a visitor who HAS a key to go set one.
    const result = await dispatchFrame(chartRequest, {
      ...base,
      wasHelloed: true,
    });
    expect(result.kind).toBe('rehello');
  });

  it('returns the keyless-visitor error when no hello ever happened', async () => {
    // Same observable state as the wake above (no key, no engine) — only
    // wasHelloed separates them, which is exactly why the attachment marker
    // exists.
    const result = await dispatchFrame(chartRequest, base);
    expect(result.kind).toBe('reply');
    if (result.kind !== 'reply') throw new Error('unreachable');
    expect(result.wire).toContain('No API key set');
  });

  it('recognises a hello frame before the rehello branch', async () => {
    // A client that re-sends its key proactively must not be answered with
    // a redundant rehello request.
    const result = await dispatchFrame(hello, { ...base, wasHelloed: true });
    expect(result.kind).toBe('hello');
  });

  it('closes on an undecodable pre-hello frame', async () => {
    const result = await dispatchFrame('not json at all', base);
    expect(result.kind).toBe('close');
    if (result.kind !== 'close') throw new Error('unreachable');
    // 1002 not 1008: the client flags 1008 as non-retryable, and a
    // reconnect here would legitimately succeed by re-sending the handshake.
    expect(result.code).toBe(1002);
  });

  it('returns a correlated error when helloed but the engine is missing', async () => {
    const result = await dispatchFrame(chartRequest, {
      ...base,
      helloReceived: true,
    });
    expect(result.kind).toBe('reply');
    if (result.kind !== 'reply') throw new Error('unreachable');
    // Correlated, not dropped: an uncorrelated reply leaves the client's
    // RequestCorrelator hanging to its timeout instead of failing fast.
    expect(result.wire).toContain('"requestId"');
    expect(result.wire).toContain('session engine unavailable');
  });

  it('never resolves the engine for a heartbeat, hello, or pre-hello frame', async () => {
    // The whole point of getEngine being a thunk instead of a plain value:
    // a transport's resolution can have side effects (SessionDO's
    // `#engineFor` constructs a fresh `createEngine(...)`, which can throw),
    // so it must only run on the path that actually needs an engine — never
    // for a frame this function already has a full answer for without one.
    let calls = 0;
    const ctx = {
      ...base,
      getEngine: () => {
        calls += 1;
        return null;
      },
    };
    await dispatchFrame(HEARTBEAT_PING_FRAME, ctx);
    await dispatchFrame(hello, ctx);
    await dispatchFrame(chartRequest, ctx); // hello-rejected: no wasHelloed
    expect(calls).toBe(0);
  });
});
