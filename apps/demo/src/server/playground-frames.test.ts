import type { ChartRequest } from '@maelstrom-co/protocol';
import { ChartRequestMessage, encodeEnvelope, SessionId } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import {
  classifyIncomingFrame,
  isHeartbeatPing,
  isPlaygroundHello,
  resolvePreHelloDispatch,
} from './playground-frames';

const MINIMAL_CHART_REQUEST: ChartRequest = {
  type: 'chart_request',
  context: {
    updateReasons: [],
    chartDimensions: { rows: 4, columns: 4 },
    layoutMode: 'grid',
  },
  instances: [],
  vessels: [],
  layout: { type: 'grid', positions: [] },
};

describe('isPlaygroundHello', () => {
  it('accepts a well-formed handshake frame', () => {
    expect(
      isPlaygroundHello({ type: 'playground.hello', sessionId: 's1', apiKey: 'sk-x' }),
    ).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(isPlaygroundHello({ type: 'playground.hello', sessionId: 's1' })).toBe(false);
  });

  it('rejects the wrong type discriminant', () => {
    expect(
      isPlaygroundHello({ type: 'chart_request', sessionId: 's1', apiKey: 'sk-x' }),
    ).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isPlaygroundHello('playground.hello')).toBe(false);
    expect(isPlaygroundHello(null)).toBe(false);
  });

  it('rejects an empty sessionId', () => {
    // An empty sessionId would collapse every crafted connection onto one
    // shared SessionEngineManager map key ('') — a raw socket hand-crafting
    // this frame directly against /ws, bypassing the shipped client (which
    // never produces an empty sessionId; it's nanoid-generated).
    expect(isPlaygroundHello({ type: 'playground.hello', sessionId: '', apiKey: 'sk-x' })).toBe(
      false,
    );
  });

  it('rejects an empty apiKey', () => {
    expect(isPlaygroundHello({ type: 'playground.hello', sessionId: 's1', apiKey: '' })).toBe(
      false,
    );
  });
});

describe('isHeartbeatPing', () => {
  it('accepts a heartbeat.ping frame', () => {
    expect(isHeartbeatPing({ type: 'heartbeat.ping' })).toBe(true);
  });
  it('rejects other frame types', () => {
    expect(isHeartbeatPing({ type: 'playground.hello' })).toBe(false);
    expect(isHeartbeatPing(null)).toBe(false);
  });
});

describe('classifyIncomingFrame', () => {
  it('classifies heartbeat.ping as heartbeat even before hello is received', () => {
    // A keyless hosted visitor never sends playground.hello (there's no key
    // to send), but the client's heartbeat timer fires regardless. If the
    // hello gate ran first, this frame would be misread as a failed
    // handshake and the socket would be closed on a visitor who was only
    // ever waiting to be prompted for a key.
    expect(classifyIncomingFrame({ type: 'heartbeat.ping' }, false)).toEqual({ kind: 'heartbeat' });
  });

  it('classifies heartbeat.ping as heartbeat after hello is received', () => {
    expect(classifyIncomingFrame({ type: 'heartbeat.ping' }, true)).toEqual({ kind: 'heartbeat' });
  });

  it('classifies a well-formed hello as hello when not yet received', () => {
    const frame = { type: 'playground.hello' as const, sessionId: 's1', apiKey: 'sk-x' };
    expect(classifyIncomingFrame(frame, false)).toEqual({ kind: 'hello', frame });
  });

  it('classifies a malformed or non-hello frame as hello-rejected when not yet received', () => {
    expect(classifyIncomingFrame({ type: 'chart_request' }, false)).toEqual({ kind: 'hello-rejected' });
    expect(classifyIncomingFrame(undefined, false)).toEqual({ kind: 'hello-rejected' });
  });

  it('classifies any non-heartbeat frame as dispatch once hello is received', () => {
    expect(classifyIncomingFrame({ type: 'chart_request' }, true)).toEqual({ kind: 'dispatch' });
    expect(classifyIncomingFrame(undefined, true)).toEqual({ kind: 'dispatch' });
  });
});

describe('resolvePreHelloDispatch', () => {
  it('replies with a correlated engine.error instead of closing for a real protocol envelope (the keyless-visitor chart_resize case)', () => {
    // Regression coverage: a keyless hosted visitor never sends
    // playground.hello, but the real client still emits protocol traffic
    // pre-hello (a ResizeObserver-driven chart_resize fires on socket open
    // regardless of key state). That traffic must not close the socket.
    const wire = encodeEnvelope(
      ChartRequestMessage({
        sessionId: SessionId('session-1'),
        request: MINIMAL_CHART_REQUEST,
      }),
    );
    const outcome = resolvePreHelloDispatch(wire);
    expect(outcome.kind).toBe('reply');
    if (outcome.kind !== 'reply') return;
    expect(outcome.message).toMatchObject({
      type: 'engine.error',
      sessionId: 'session-1',
    });
  });

  it('closes for a frame that does not even decode as a protocol envelope', () => {
    expect(resolvePreHelloDispatch({ garbage: true })).toEqual({ kind: 'close' });
    expect(resolvePreHelloDispatch(undefined)).toEqual({ kind: 'close' });
  });
});
