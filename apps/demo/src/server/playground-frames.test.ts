import { describe, expect, it } from 'vitest';
import { isHeartbeatPing, isPlaygroundHello } from './playground-frames';

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
