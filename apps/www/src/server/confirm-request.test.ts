import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { decodeConfirmRequest } from './confirm-request';

const formPost = (
  body: BodyInit,
  contentType = 'application/x-www-form-urlencoded',
) =>
  new Request('https://maelstrom-ai.co/api/waitlist/confirm', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });

const failureOf = async (request: Request) =>
  Effect.runPromise(Effect.flip(decodeConfirmRequest(request)));

describe('decodeConfirmRequest', () => {
  test('rejects a non-form media type before reading the body', async () => {
    const failure = await failureOf(
      formPost(JSON.stringify({ token: 'x' }), 'application/json'),
    );
    expect(failure._tag).toBe('UnsupportedMediaType');
  });

  test('rejects a body above the 512-byte confirm limit', async () => {
    const failure = await failureOf(
      formPost(new URLSearchParams({ token: 'a'.repeat(600) })),
    );
    expect(failure._tag).toBe('BodyTooLarge');
  });

  test('rejects a malformed token without producing a token value', async () => {
    const failure = await failureOf(
      formPost(new URLSearchParams({ token: 'not-a-token' })),
    );
    expect(failure._tag).toBe('InvalidConfirmToken');
  });

  test('decodes a live confirmation token', async () => {
    const token = `v1.${'a'.repeat(43)}`;
    const decoded = await Effect.runPromise(
      decodeConfirmRequest(formPost(new URLSearchParams({ token }))),
    );
    expect(decoded.token).toBe(token);
  });
});
