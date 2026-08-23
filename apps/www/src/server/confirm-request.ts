import { Data, Effect } from 'effect';
import { readLimitedBody } from '../lib/read-limited-body';
import { isWaitlistToken } from '../lib/waitlist-token';
import { BodyTooLarge, UnsupportedMediaType } from './signup-request';

const MAX_CONFIRMATION_BODY_BYTES = 512;

/** Decoded confirmation token before any persistence runs. */
export interface ConfirmRequest {
  readonly token: string;
}

export class InvalidConfirmToken extends Data.TaggedError(
  'InvalidConfirmToken',
)<Record<string, never>> {}

/**
 * Parses the form media type, size-bounded body, and live confirmation
 * token. Invalid tokens fail here so the handler never hashes or queries.
 */
export const decodeConfirmRequest = (
  request: Request,
): Effect.Effect<
  ConfirmRequest,
  UnsupportedMediaType | BodyTooLarge | InvalidConfirmToken
> =>
  Effect.gen(function* () {
    const mediaType = request.headers
      .get('Content-Type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== 'application/x-www-form-urlencoded') {
      return yield* new UnsupportedMediaType({});
    }

    const body = yield* Effect.promise(() =>
      readLimitedBody(request, MAX_CONFIRMATION_BODY_BYTES),
    );
    if (!body.ok) {
      return yield* body.tooLarge
        ? new BodyTooLarge({})
        : new InvalidConfirmToken({});
    }

    const token = new URLSearchParams(body.text).get('token');
    if (!isWaitlistToken(token)) return yield* new InvalidConfirmToken({});
    return { token };
  });
