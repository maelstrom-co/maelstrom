/**
 * Engine construction behind a typed-error boundary.
 *
 * Building a playground engine from a visitor's API key is the one step
 * that can fail with the key in reach: a provider SDK error message may
 * echo the rejected key verbatim. The factory is the single place that
 * step happens, and its failure channel carries only an
 * {@link EngineBuildError} whose message was scrubbed through
 * `redactSecrets` before the error object exists — nothing downstream can
 * log, reply with, or serialize the raw failure.
 */

import type { Engine } from '@maelstrom-co/engine';
import { Context, Data, Effect, Layer } from 'effect';
import { createPlaygroundEngine } from '../../server/engine-config';
import { createDemoOpenaiChat } from '../../server/engine-model';
import { createRedactingLogger, redact } from '../../server/redact';

// OpenAI shares this budget between reasoning and visible output, so layout
// JSON has less headroom than the cap suggests. TanStack reports max_tokens
// when native structured output exhausts the budget.
const MAX_OUTPUT_TOKENS = 16384;

/** A failed engine build. The message is redacted before construction. */
export class EngineBuildError extends Data.TaggedError(
  'SessionEngineBuildError',
)<{
  readonly message: string;
}> {}

export interface EngineFactoryService {
  /**
   * Builds a fresh engine wired to `apiKey`, with the redacting logger every
   * hosted-mode engine requires (see {@link createPlaygroundEngine}). Fails
   * with a redacted {@link EngineBuildError} — never with the cause itself.
   */
  readonly make: (apiKey: string) => Effect.Effect<Engine, EngineBuildError>;
}

export class EngineFactory extends Context.Service<
  EngineFactory,
  EngineFactoryService
>()('@maelstrom/demo/EngineFactory') {}

export const EngineFactoryLive = Layer.effect(
  EngineFactory,
  Effect.gen(function* () {
    const make = Effect.fn('EngineFactory.make')(function* (apiKey: string) {
      return yield* Effect.try({
        try: () =>
          createPlaygroundEngine({
            adapter: createDemoOpenaiChat(apiKey),
            // observability.logs.persist is on: without this the default
            // consoleLogger writes OpenAI's 401 key echo into retained logs.
            logger: createRedactingLogger(apiKey),
            modelOptions: { max_output_tokens: MAX_OUTPUT_TOKENS },
          }),
        catch: (cause) =>
          new EngineBuildError({ message: redact(cause, apiKey).message }),
      });
    });

    return EngineFactory.of({ make });
  }),
);
