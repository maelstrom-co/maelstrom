import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

/** Only stage permitted to own retained production resources. */
export const PRODUCTION_STAGE = 'prod';
const PREVIEW_STAGE_PATTERN = /^pr-[1-9]\d*$/;

/**
 * Environment variable holding the account ID a deployment is allowed to
 * mutate. A non-secret repository variable, compared against the active
 * `CLOUDFLARE_ACCOUNT_ID` before any resource is declared.
 */
export const EXPECTED_ACCOUNT_ENV = 'EXPECTED_CLOUDFLARE_ACCOUNT_ID';
const ACTIVE_ACCOUNT_ENV = 'CLOUDFLARE_ACCOUNT_ID';

/** Fail an Effect when the active Cloudflare account is not the expected one.
 *
 * A swapped or misconfigured credential otherwise deploys into the wrong
 * account and passes every stage guard. When `EXPECTED_CLOUDFLARE_ACCOUNT_ID`
 * is unset the check is skipped so local profiles keep working; CI always sets
 * it.
 */
export const requireExpectedAccount = (scope: string) =>
  Effect.gen(function* () {
    const expected = process.env[EXPECTED_ACCOUNT_ENV]?.trim();
    if (!expected) return;
    const active = process.env[ACTIVE_ACCOUNT_ENV]?.trim();
    if (active !== expected) {
      yield* Effect.die(
        new Error(
          `The ${scope} stack resolved Cloudflare account ${active ?? '(unset)'} but ${EXPECTED_ACCOUNT_ENV} names ${expected}`,
        ),
      );
    }
  });

const requireStage = (scope: string, stage: string) =>
  Effect.gen(function* () {
    yield* requireExpectedAccount(scope);
    return stage;
  });

/** Fail an Effect when a retained stack is evaluated outside production. */
export const requireProductionStage = (scope: string) =>
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    if (stage !== PRODUCTION_STAGE) {
      return yield* Effect.die(
        new Error(
          `The ${scope} stack only supports --stage ${PRODUCTION_STAGE}; received ${stage}`,
        ),
      );
    }
    return yield* requireStage(scope, stage);
  });

/** Require and return a canonical `pr-<number>` preview stage. */
export const requirePreviewStage = (scope: string) =>
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    if (!PREVIEW_STAGE_PATTERN.test(stage)) {
      return yield* Effect.die(
        new Error(
          `The ${scope} stack requires --stage pr-<number>; received ${stage}`,
        ),
      );
    }
    return yield* requireStage(scope, stage);
  });
