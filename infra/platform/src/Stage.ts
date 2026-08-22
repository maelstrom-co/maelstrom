import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

/** Only stage permitted to own retained production resources. */
export const PRODUCTION_STAGE = 'prod';
const PREVIEW_STAGE_PATTERN = /^pr-[1-9]\d*$/;

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
    return stage;
  });
