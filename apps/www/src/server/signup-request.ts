import { Data, Effect } from 'effect';
import { readLimitedBody } from '../lib/read-limited-body';
import { validateWaitlistEmail } from '../lib/waitlist';

const MAX_BODY_BYTES = 4096;
const MAX_TURNSTILE_TOKEN_CHARS = 2048;

/** Decoded signup input before any policy runs. */
export interface SignupRequest {
  readonly email: string;
  /** Null when absent, non-string, or above the bounded length. */
  readonly turnstileToken: string | null;
}

export class UnsupportedMediaType extends Data.TaggedError(
  'UnsupportedMediaType',
)<Record<string, never>> {}
export class BodyTooLarge extends Data.TaggedError('BodyTooLarge')<
  Record<string, never>
> {}
export class InvalidBody extends Data.TaggedError('InvalidBody')<
  Record<string, never>
> {}
export class InvalidEmail extends Data.TaggedError('InvalidEmail')<{
  readonly error: string;
}> {}
export class MissingTurnstileToken extends Data.TaggedError(
  'MissingTurnstileToken',
)<Record<string, never>> {}

/**
 * Parses the media type, size-bounded body, email identity, and raw
 * Turnstile token. Pure boundary parsing: policy decisions such as whether a
 * missing token rejects the request stay with the caller so deployment
 * ordering (for example a bindings check before token enforcement) is
 * preserved.
 */
export const decodeSignupRequest = (
  request: Request,
): Effect.Effect<
  SignupRequest,
  UnsupportedMediaType | BodyTooLarge | InvalidBody | InvalidEmail
> =>
  Effect.gen(function* () {
    const mediaType = request.headers
      .get('Content-Type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      return yield* new UnsupportedMediaType({});
    }

    const body = yield* Effect.promise(() =>
      readLimitedBody(request, MAX_BODY_BYTES),
    );
    if (!body.ok) {
      return yield* body.tooLarge ? new BodyTooLarge({}) : new InvalidBody({});
    }

    let value: unknown;
    try {
      value = JSON.parse(body.text);
    } catch {
      return yield* new InvalidBody({});
    }

    const validation = validateWaitlistEmail(value);
    if (!validation.ok) {
      return yield* new InvalidEmail({ error: validation.error });
    }

    return {
      email: validation.email,
      turnstileToken: readTurnstileToken(value),
    };
  });

/** Enforces token presence once the caller's earlier policies have passed. */
export const requireTurnstileToken = (
  token: string | null,
): Effect.Effect<string, MissingTurnstileToken> =>
  token ? Effect.succeed(token) : Effect.fail(new MissingTurnstileToken({}));

function readTurnstileToken(body: unknown): string | null {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('turnstileToken' in body)
  ) {
    return null;
  }
  const token = Reflect.get(body, 'turnstileToken');
  return typeof token === 'string' &&
    token.length > 0 &&
    token.length <= MAX_TURNSTILE_TOKEN_CHARS
    ? token
    : null;
}
