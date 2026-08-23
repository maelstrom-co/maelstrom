import { Data, Effect } from 'effect';
import { readLimitedBody } from '../lib/read-limited-body';
import { validateWaitlistEmail } from '../lib/waitlist';

const MAX_BODY_BYTES = 4096;
const MAX_TURNSTILE_TOKEN_CHARS = 2048;

/** Normalized resend input before origin and Turnstile policy. */
export interface WaitlistResendRequest {
  /** Normalized subscriber email. */
  readonly email: string;
  /** Null when missing, malformed, empty, or above the token bound. */
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
 * Decodes the bounded JSON resend boundary before origin or proof policy runs.
 * Token defects remain nullable so the route can enforce Origin first.
 */
export const decodeWaitlistResendRequest = (
  request: Request,
): Effect.Effect<
  WaitlistResendRequest,
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
    const token = readTurnstileToken(value);

    return { email: validation.email, turnstileToken: token };
  });

/** Requires a usable proof token after origin enforcement has passed. */
export const requireResendTurnstileToken = (
  token: string | null,
): Effect.Effect<string, MissingTurnstileToken> =>
  token ? Effect.succeed(token) : Effect.fail(new MissingTurnstileToken({}));

function readTurnstileToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const token = Reflect.get(body, 'turnstileToken');
  return typeof token === 'string' &&
    token.length > 0 &&
    token.length <= MAX_TURNSTILE_TOKEN_CHARS
    ? token
    : null;
}
