import { describe, expect, it } from 'bun:test';
import { SessionId } from './session.js';
import {
  TokenHandshakeRequestSchema,
  TokenHandshakeResponseSchema,
} from './token-handshake.js';

describe('TokenHandshakeRequestSchema', () => {
  it('accepts a valid openai mint request', () => {
    const parsed = TokenHandshakeRequestSchema.parse({
      provider: 'openai',
      sessionId: SessionId('sess-1'),
    });
    expect(parsed.provider).toBe('openai');
  });

  it('rejects an unknown provider', () => {
    expect(() =>
      TokenHandshakeRequestSchema.parse({ provider: 'anthropic', sessionId: SessionId('s') }),
    ).toThrow();
  });

  it('rejects a request missing sessionId', () => {
    expect(() => TokenHandshakeRequestSchema.parse({ provider: 'openai' })).toThrow();
  });
});

describe('TokenHandshakeResponseSchema', () => {
  it('accepts a valid ephemeral credential', () => {
    const parsed = TokenHandshakeResponseSchema.parse({
      provider: 'openai',
      value: 'ek-abc123',
      expiresAt: 1712345678,
      model: 'gpt-realtime-1.5',
    });
    expect(parsed.value).toBe('ek-abc123');
  });

  it('rejects an empty credential value', () => {
    expect(() =>
      TokenHandshakeResponseSchema.parse({
        provider: 'openai', value: '', expiresAt: 1, model: 'm',
      }),
    ).toThrow();
  });

  it('rejects an empty model', () => {
    expect(() =>
      TokenHandshakeResponseSchema.parse({
        provider: 'openai', value: 'ek-x', expiresAt: 1, model: '',
      }),
    ).toThrow();
  });

  it('rejects a non-positive expiresAt', () => {
    expect(() =>
      TokenHandshakeResponseSchema.parse({
        provider: 'openai', value: 'ek-x', expiresAt: 0, model: 'm',
      }),
    ).toThrow();
  });
});
