import { describe, expect, test } from 'bun:test';
import { readLimitedBody } from './read-limited-body';

describe('readLimitedBody', () => {
  test('reads a body within the endpoint contract', async () => {
    const result = await readLimitedBody(
      new Request('https://example.com', { method: 'POST', body: 'hello' }),
      5,
    );
    expect(result).toEqual({ ok: true, text: 'hello' });
  });

  test('rejects a declared oversized body before reading it', async () => {
    const result = await readLimitedBody(
      new Request('https://example.com', {
        method: 'POST',
        headers: { 'content-length': '6' },
        body: 'hello',
      }),
      5,
    );
    expect(result).toEqual({ ok: false, tooLarge: true });
  });
});
