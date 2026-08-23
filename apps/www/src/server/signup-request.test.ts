import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { validateWaitlistEmail } from '../lib/waitlist';
import { decodeSignupRequest, requireTurnstileToken } from './signup-request';

const jsonPost = (body: BodyInit, contentType?: string) =>
  new Request('https://maelstrom-ai.co/api/waitlist', {
    method: 'POST',
    headers: contentType === undefined ? {} : { 'Content-Type': contentType },
    body,
  });

const jsonPostValue = (value: unknown) =>
  jsonPost(JSON.stringify(value), 'application/json');

/** Runs decode and returns the typed failure; fails the test on success. */
const failureOf = async (request: Request) =>
  Effect.runPromise(Effect.flip(decodeSignupRequest(request)));

describe('decodeSignupRequest', () => {
  test('rejects a non-JSON media type before reading the body', async () => {
    const failure = await failureOf(
      jsonPost('email=user@example.com', 'application/x-www-form-urlencoded'),
    );
    expect(failure._tag).toBe('UnsupportedMediaType');
  });

  test('rejects a body above the 4096-byte limit', async () => {
    const filler = 'x'.repeat(4100);
    const failure = await failureOf(
      jsonPostValue({ email: 'user@example.com', turnstileToken: filler }),
    );
    expect(failure._tag).toBe('BodyTooLarge');
  });

  test('rejects malformed JSON', async () => {
    const failure = await failureOf(jsonPost('{', 'application/json'));
    expect(failure._tag).toBe('InvalidBody');
  });

  test('maps an invalid email to InvalidEmail with the shared validator message', async () => {
    const failure = await failureOf(
      jsonPostValue({ email: 'not-an-email', turnstileToken: 'tok' }),
    );
    expect(failure._tag).toBe('InvalidEmail');
    if (failure._tag !== 'InvalidEmail') return;
    expect(failure.error).toBe(
      validateWaitlistEmail({ email: 'not-an-email' }).error,
    );
  });

  test('normalizes the email exactly like the shared validator', async () => {
    const decoded = await Effect.runPromise(
      decodeSignupRequest(
        jsonPostValue({ email: '  USER@Example.COM ', turnstileToken: 'tok' }),
      ),
    );
    // The shared validator trims and lowercases; parity is load-bearing
    // because D1 identity is case-insensitive on this exact value.
    expect(decoded.email).toBe('user@example.com');
  });

  test.each([
    ['missing token', { email: 'user@example.com' }],
    ['empty token', { email: 'user@example.com', turnstileToken: '' }],
    ['non-string token', { email: 'user@example.com', turnstileToken: 42 }],
    [
      'token above 2048 chars',
      { email: 'user@example.com', turnstileToken: 'x'.repeat(2049) },
    ],
  ])('leaves %s as null so policy ordering stays with the caller', async (_name, value) => {
    const decoded = await Effect.runPromise(
      decodeSignupRequest(jsonPostValue(value)),
    );
    expect(decoded.turnstileToken).toBeNull();
  });

  test('decodes a valid signup with its bounded token', async () => {
    const decoded = await Effect.runPromise(
      decodeSignupRequest(
        jsonPostValue({
          email: 'user@example.com',
          turnstileToken: 'tok'.padEnd(2048, 'x'),
        }),
      ),
    );
    expect(decoded).toEqual({
      email: 'user@example.com',
      turnstileToken: 'tok'.padEnd(2048, 'x'),
    });
  });
});

describe('requireTurnstileToken', () => {
  test('passes a present token through unchanged', async () => {
    const token = await Effect.runPromise(requireTurnstileToken('tok'));
    expect(token).toBe('tok');
  });

  test('fails typed when no usable token was decoded', async () => {
    const failure = await Effect.runPromise(
      Effect.flip(requireTurnstileToken(null)),
    );
    expect(failure._tag).toBe('MissingTurnstileToken');
  });
});
