import { describe, expect, test } from 'bun:test';
import {
  isLiveKitTriggerBinding,
  parseLiveKitTriggerBinding,
} from './livekit-trigger.js';

const binding = {
  version: 1 as const,
  roomName: 'room',
  browserIdentity: 'user',
  workerIdentity: 'worker',
  expiresAt: 100,
};

describe('trigger bootstrap metadata', () => {
  test('accepts a bounded binding only before its admission deadline', () => {
    expect(parseLiveKitTriggerBinding(JSON.stringify(binding), 99)).toEqual(
      binding,
    );
    expect(
      parseLiveKitTriggerBinding(JSON.stringify(binding), 100),
    ).toBeUndefined();
  });
  test('rejects malformed, missing, unbounded and invalid fields', () => {
    for (const value of [
      null,
      {},
      { ...binding, version: 2 },
      { ...binding, roomName: '' },
      { ...binding, workerIdentity: ' ' },
      { ...binding, browserIdentity: 'x'.repeat(513) },
      { ...binding, expiresAt: Infinity },
      { ...binding, expiresAt: 0 },
      { ...binding, expiresAt: 1.5 },
    ]) {
      expect(isLiveKitTriggerBinding(value)).toBe(false);
    }
    expect(parseLiveKitTriggerBinding('{', 0)).toBeUndefined();
    expect(parseLiveKitTriggerBinding(' '.repeat(4097), 0)).toBeUndefined();
  });
});
