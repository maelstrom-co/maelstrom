import { describe, expect, it } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';

import {
  OpenAITokenGrantSchema,
  OpenAITokenRequestSchema,
} from './openai-token.js';

describe('OpenAITokenRequestSchema', () => {
  it('accepts a valid openai mint request', () => {
    const parsed = OpenAITokenRequestSchema.parse({
      provider: 'openai',
      sessionId: SessionId('sess-1'),
    });
    expect(parsed.provider).toBe('openai');
  });

  it('rejects an unknown provider', () => {
    expect(() =>
      OpenAITokenRequestSchema.parse({
        provider: 'anthropic',
        sessionId: SessionId('s'),
      }),
    ).toThrow();
  });

  it('rejects a request missing sessionId', () => {
    expect(() =>
      OpenAITokenRequestSchema.parse({ provider: 'openai' }),
    ).toThrow();
  });
});

describe('OpenAITokenGrantSchema', () => {
  it('accepts a valid ephemeral credential', () => {
    const parsed = OpenAITokenGrantSchema.parse({
      provider: 'openai',
      value: 'ek-abc123',
      expiresAt: 1712345678,
      model: 'gpt-realtime-1.5',
    });
    expect(parsed.value).toBe('ek-abc123');
  });

  it('rejects an empty credential value', () => {
    expect(() =>
      OpenAITokenGrantSchema.parse({
        provider: 'openai',
        value: '',
        expiresAt: 1,
        model: 'm',
      }),
    ).toThrow();
  });

  it('rejects an empty model', () => {
    expect(() =>
      OpenAITokenGrantSchema.parse({
        provider: 'openai',
        value: 'ek-x',
        expiresAt: 1,
        model: '',
      }),
    ).toThrow();
  });

  it('rejects a non-positive expiresAt', () => {
    expect(() =>
      OpenAITokenGrantSchema.parse({
        provider: 'openai',
        value: 'ek-x',
        expiresAt: 0,
        model: 'm',
      }),
    ).toThrow();
  });
});
