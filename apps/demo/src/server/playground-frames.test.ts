import type { ChartRequest } from '@maelstrom-co/protocol';
import {
  ChartRequestMessage,
  encodeEnvelope,
  SessionId,
} from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import {
  classifyIncomingFrame,
  isHeartbeatPing,
  isPlaygroundHello,
  resolvePreHelloDispatch,
} from './playground-frames';

// 24 chars — clears the 20-char floor with room to spare, well short of a
// real OpenAI key (40+), but long enough that the tests below exercise the
// length gate rather than accidentally passing on some other field.
const VALID_API_KEY = 'sk-test-abcdefghijklm123';

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
      isPlaygroundHello({
        type: 'playground.hello',
        sessionId: 's1',
        apiKey: VALID_API_KEY,
      }),
    ).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(
      isPlaygroundHello({ type: 'playground.hello', sessionId: 's1' }),
    ).toBe(false);
  });

  it('rejects the wrong type discriminant', () => {
    expect(
      isPlaygroundHello({
        type: 'chart_request',
        sessionId: 's1',
        apiKey: VALID_API_KEY,
      }),
    ).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isPlaygroundHello('playground.hello')).toBe(false);
    expect(isPlaygroundHello(null)).toBe(false);
  });

  it('rejects an empty sessionId', () => {
    // An empty sessionId would collapse every crafted connection onto the
    // same Durable Object (idFromName('')) — a raw socket hand-crafting
    // this frame directly against /ws, bypassing the shipped client (which
    // never produces an empty sessionId; it's nanoid-generated).
    expect(
      isPlaygroundHello({
        type: 'playground.hello',
        sessionId: '',
        apiKey: VALID_API_KEY,
      }),
    ).toBe(false);
  });

  it('rejects an empty apiKey', () => {
    expect(
      isPlaygroundHello({
        type: 'playground.hello',
        sessionId: 's1',
        apiKey: '',
      }),
    ).toBe(false);
  });

  it('rejects an apiKey shorter than the 20-char floor', () => {
    // A real OpenAI key is 40+ chars, so this floor never rejects a genuine
    // key. Below it, redactSecrets's exact-match pass mangles unrelated
    // wire content (a 1-char key turns "executionPlan" into
    // "executionPl[redacted]n"), so a too-short key must never reach the
    // point where a session engine gets built for it — the visitor should
    // hit an "invalid API key" path, not a hung request.
    expect(
      isPlaygroundHello({
        type: 'playground.hello',
        sessionId: 's1',
        apiKey: 'sk-short-19-chars12',
      }),
    ).toBe(false);
  });

  it('accepts an apiKey exactly at the 20-char floor', () => {
    const exactlyTwenty = 'sk-exactly-20-chars0';
    expect(exactlyTwenty).toHaveLength(20);
    expect(
      isPlaygroundHello({
        type: 'playground.hello',
        sessionId: 's1',
        apiKey: exactlyTwenty,
      }),
    ).toBe(true);
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
    expect(classifyIncomingFrame({ type: 'heartbeat.ping' }, false)).toEqual({
      kind: 'heartbeat',
    });
  });

  it('classifies heartbeat.ping as heartbeat after hello is received', () => {
    expect(classifyIncomingFrame({ type: 'heartbeat.ping' }, true)).toEqual({
      kind: 'heartbeat',
    });
  });

  it('classifies a well-formed hello as hello when not yet received', () => {
    const frame = {
      type: 'playground.hello' as const,
      sessionId: 's1',
      apiKey: VALID_API_KEY,
    };
    expect(classifyIncomingFrame(frame, false)).toEqual({
      kind: 'hello',
      frame,
    });
  });

  it('classifies a malformed or non-hello frame as hello-rejected when not yet received', () => {
    expect(classifyIncomingFrame({ type: 'chart_request' }, false)).toEqual({
      kind: 'hello-rejected',
    });
    expect(classifyIncomingFrame(undefined, false)).toEqual({
      kind: 'hello-rejected',
    });
  });

  it('classifies any non-heartbeat frame as dispatch once hello is received', () => {
    expect(classifyIncomingFrame({ type: 'chart_request' }, true)).toEqual({
      kind: 'dispatch',
    });
    expect(classifyIncomingFrame(undefined, true)).toEqual({
      kind: 'dispatch',
    });
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
    expect(resolvePreHelloDispatch({ garbage: true })).toEqual({
      kind: 'close',
    });
    expect(resolvePreHelloDispatch(undefined)).toEqual({ kind: 'close' });
  });
});
