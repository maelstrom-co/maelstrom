import {
  isWaitlistProductionHostname,
  WAITLIST_TURNSTILE_ACTION,
} from '@maelstrom-co/platform-infra/waitlist-contract';
import { Context, Data, Duration, Effect, Layer, Option } from 'effect';
import { HttpClient } from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { readProperty } from './read-property';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const PROVIDER_CODES = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'missing-input-response',
  'invalid-input-response',
  'bad-request',
  'timeout-or-duplicate',
  'internal-error',
]);
const UNAVAILABLE_CODES = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'missing-input-response',
  'bad-request',
  'internal-error',
]);

export class TurnstileRejected extends Data.TaggedError('TurnstileRejected')<{
  readonly reason:
    | 'challenge_rejected'
    | 'action_mismatch'
    | 'hostname_mismatch';
  readonly providerCodes: ReadonlyArray<string>;
}> {}
export class TurnstileUnavailable extends Data.TaggedError(
  'TurnstileUnavailable',
)<{
  readonly category:
    | 'provider_http'
    | 'provider_response'
    | 'provider_unavailable'
    | 'request_timeout'
    | 'request_failed';
}> {}

export type TurnstileVerifierError = TurnstileRejected | TurnstileUnavailable;

export interface TurnstileVerifierService {
  /**
   * Verifies one challenge token. Never retries: a duplicate challenge can
   * flip to invalid, so the provider must see exactly one request.
   */
  readonly verify: (
    token: string,
    remoteIp: string | null,
  ) => Effect.Effect<void, TurnstileVerifierError>;
}

export class TurnstileVerifier extends Context.Service<
  TurnstileVerifier,
  TurnstileVerifierService
>()('@maelstrom/www/TurnstileVerifier') {
  /**
   * Builds the verifier over the ambient HttpClient. The secret is injected
   * per stack (Workers bindings are not environment variables), so production
   * wires it from `TURNSTILE_SECRET_KEY`.
   */
  static readonly make = (options: {
    readonly secret: string;
    readonly timeout?: Duration.Input;
  }): Effect.Effect<TurnstileVerifierService, never, HttpClient> =>
    Effect.gen(function* () {
      const client = yield* HttpClient;
      const timeoutDuration = options.timeout ?? Duration.seconds(5);

      return TurnstileVerifier.of({
        verify: Effect.fn('TurnstileVerifier.verify')(
          function* (token, remoteIp) {
            const request = HttpClientRequest.bodyJsonUnsafe(
              HttpClientRequest.post(SITEVERIFY_URL),
              {
                secret: options.secret,
                response: token,
                ...(remoteIp ? { remoteip: remoteIp } : {}),
              },
            );

            const response = yield* client.execute(request).pipe(
              Effect.catch(() => failLogged('request_failed', [])),
              Effect.timeoutOption(timeoutDuration),
              Effect.flatMap((timed) =>
                Option.isNone(timed)
                  ? failLogged('request_timeout', [])
                  : Effect.succeed(timed.value),
              ),
            );

            if (response.status !== 200) {
              return yield* logAndFail('provider_http', []);
            }

            const payload = yield* response.json.pipe(
              Effect.catch(() => logAndFail('provider_response', [])),
            );
            if (!isRecord(payload)) {
              return yield* logAndFail('provider_response', []);
            }

            const success = readProperty(payload, 'success');
            if (success !== true) {
              const codes = readProviderCodes(payload);
              const category = codes.some((code) => UNAVAILABLE_CODES.has(code))
                ? 'provider_unavailable'
                : 'challenge_rejected';
              logFailure(category, codes);
              return yield* category === 'provider_unavailable'
                ? failUnavailable(category)
                : new TurnstileRejected({
                    reason: category,
                    providerCodes: codes,
                  });
            }

            const action = readProperty(payload, 'action');
            if (action !== WAITLIST_TURNSTILE_ACTION) {
              return yield* rejectedWithCodes('action_mismatch', payload);
            }
            const hostname = readProperty(payload, 'hostname');
            if (
              typeof hostname !== 'string' ||
              !isWaitlistProductionHostname(hostname)
            ) {
              return yield* rejectedWithCodes('hostname_mismatch', payload);
            }
          },
        ),
      });
    });

  /** Layer form of {@link TurnstileVerifier.make} over the ambient client. */
  static readonly layer = (options: {
    readonly secret: string;
    readonly timeout?: Duration.Input;
  }): Layer.Layer<TurnstileVerifier, never, HttpClient> =>
    Layer.effect(TurnstileVerifier, TurnstileVerifier.make(options));
}

/** Every unavailability path must leave a trace in operational logs. */
const failLogged = (
  category: TurnstileUnavailable['category'],
  codes: ReadonlyArray<string>,
) => {
  logFailure(category, codes);
  return Effect.fail(failUnavailable(category));
};

const failUnavailable = (category: TurnstileUnavailable['category']) =>
  new TurnstileUnavailable({ category });

const logAndFail = failLogged;

const rejectedWithCodes = (
  reason: 'action_mismatch' | 'hostname_mismatch',
  payload: unknown,
) => {
  const codes = readProviderCodes(payload);
  logFailure(reason, codes);
  return Effect.fail(new TurnstileRejected({ reason, providerCodes: codes }));
};

function logFailure(
  category: string,
  providerCodes: ReadonlyArray<string>,
): void {
  console.error({
    message: 'waitlist Turnstile verification failed',
    category,
    providerCodes: [...new Set(providerCodes)],
  });
}

function readProviderCodes(result: unknown): ReadonlyArray<string> {
  const codes = readProperty(result, 'error-codes');
  return Array.isArray(codes)
    ? codes.filter(
        (code): code is string =>
          typeof code === 'string' && PROVIDER_CODES.has(code),
      )
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
