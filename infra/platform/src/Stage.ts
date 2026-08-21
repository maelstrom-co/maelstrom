import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

export const PRODUCTION_STAGE = 'prod';
const PREVIEW_STAGE_PATTERN = /^pr-[1-9]\d*$/;

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
