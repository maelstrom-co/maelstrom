import * as Alchemy from 'alchemy';
import * as Effect from 'effect/Effect';

export const PRODUCTION_STAGE = 'prod';

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
