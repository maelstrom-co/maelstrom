import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { decodeWaitlistResendRequest } from './waitlist-resend-request';

const request = (value: unknown, contentType = 'application/json') =>
  new Request('https://maelstrom-ai.co/api/waitlist/resend', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: typeof value === 'string' ? value : JSON.stringify(value),
  });

const failureOf = (input: Request) =>
  Effect.runPromise(Effect.flip(decodeWaitlistResendRequest(input)));

describe('decodeWaitlistResendRequest', () => {
  test('normalizes a valid email and preserves a bounded token', async () => {
    await expect(
      Effect.runPromise(
        decodeWaitlistResendRequest(
          request({
            email: '  USER@Example.COM ',
            turnstileToken: 'token'.padEnd(2048, 'x'),
          }),
        ),
      ),
    ).resolves.toEqual({
      email: 'user@example.com',
      turnstileToken: 'token'.padEnd(2048, 'x'),
    });
  });

  test.each([
    [
      'unsupported media type',
      request('{}', 'text/plain'),
      'UnsupportedMediaType',
    ],
    [
      'oversized body',
      request({
        email: `${'a'.repeat(4096)}@example.com`,
        turnstileToken: 'x',
      }),
      'BodyTooLarge',
    ],
    ['malformed JSON', request('{'), 'InvalidBody'],
    [
      'invalid email',
      request({ email: 'invalid', turnstileToken: 'x' }),
      'InvalidEmail',
    ],
  ])('rejects %s with a typed boundary error', async (_name, input, tag) => {
    expect((await failureOf(input))._tag).toBe(tag);
  });

  test.each([
    ['missing token', { email: 'user@example.com' }],
    [
      'oversized token',
      { email: 'user@example.com', turnstileToken: 'x'.repeat(2049) },
    ],
  ])('leaves %s for policy after origin enforcement', async (_name, value) => {
    const decoded = await Effect.runPromise(
      decodeWaitlistResendRequest(request(value)),
    );
    expect(decoded.turnstileToken).toBeNull();
  });
});
