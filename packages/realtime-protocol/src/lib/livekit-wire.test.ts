import { describe, expect, test } from 'bun:test';

import { parseTriggerTurnPacket } from './livekit-wire.js';

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));

describe('trigger turn wire validation', () => {
  test('accepts a versioned capability request and bounded drain acknowledgement', () => {
    const request = {
      type: 'turn_capability',
      version: 1,
      nonce: 'connection-1',
    } as const;
    expect(parseTriggerTurnPacket(encode(request))).toEqual(request);
    const ack = {
      ...request,
      type: 'turn_capability_ack',
      drainTimeoutMs: 60_000,
    } as const;
    expect(parseTriggerTurnPacket(encode(ack))).toEqual(ack);
    expect(
      parseTriggerTurnPacket(encode({ ...ack, drainTimeoutMs: 60_001 })),
    ).toBeNull();
  });

  test('requires complete identity and explicit terminal outcome', () => {
    const terminal = {
      type: 'turn_result',
      version: 1,
      nonce: 'connection-1',
      turnId: 1,
      outcome: 'success',
      text: 'hello maelstrom',
    } as const;
    expect(parseTriggerTurnPacket(encode(terminal))).toEqual(terminal);
    for (const patch of [
      { nonce: '' },
      { nonce: 'x'.repeat(129) },
      { turnId: 0 },
      { turnId: 1.5 },
      { version: 2 },
      { outcome: 'error' },
      { text: '' },
    ]) {
      expect(
        parseTriggerTurnPacket(encode({ ...terminal, ...patch })),
      ).toBeNull();
    }
    const error = { ...terminal, outcome: 'error', text: '' } as const;
    expect(parseTriggerTurnPacket(encode(error))).toEqual(error);
  });

  test('rejects malformed and oversized packets without throwing', () => {
    expect(parseTriggerTurnPacket(new TextEncoder().encode('{'))).toBeNull();
    expect(parseTriggerTurnPacket(encode(null))).toBeNull();
    expect(parseTriggerTurnPacket(encode({ type: 'turn_end' }))).toBeNull();
    expect(parseTriggerTurnPacket(new Uint8Array(300_000))).toBeNull();
  });
});
