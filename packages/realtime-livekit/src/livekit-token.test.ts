import { describe, expect, test } from 'bun:test';
import { LiveKitTokenGrantSchema } from './livekit-token.js';

const EXPIRES_AT = Math.floor(Date.now() / 1000) + 900;

describe('LiveKitTokenGrantSchema url', () => {
  test('accepts a wss:// room URL', () => {
    const parsed = LiveKitTokenGrantSchema.parse({
      token: 'test-token',
      url: 'wss://host.livekit.cloud',
      expiresAt: EXPIRES_AT,
    });
    expect(parsed.url).toBe('wss://host.livekit.cloud');
  });

  test('accepts a ws:// room URL', () => {
    const parsed = LiveKitTokenGrantSchema.parse({
      token: 'test-token',
      url: 'ws://localhost:7880',
      expiresAt: EXPIRES_AT,
    });
    expect(parsed.url).toBe('ws://localhost:7880');
  });

  test('rejects an http(s):// URL — room.connect() requires ws/wss', () => {
    const result = LiveKitTokenGrantSchema.safeParse({
      token: 'test-token',
      url: 'https://example.com',
      expiresAt: EXPIRES_AT,
    });
    expect(result.success).toBe(false);
  });

  test('rejects a non-empty string that is not a URL', () => {
    const result = LiveKitTokenGrantSchema.safeParse({
      token: 'test-token',
      url: 'not a url',
      expiresAt: EXPIRES_AT,
    });
    expect(result.success).toBe(false);
  });

  test('rejects an empty url', () => {
    const result = LiveKitTokenGrantSchema.safeParse({
      token: 'test-token',
      url: '',
      expiresAt: EXPIRES_AT,
    });
    expect(result.success).toBe(false);
  });
});
