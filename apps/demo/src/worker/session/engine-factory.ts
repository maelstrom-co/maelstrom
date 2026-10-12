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
import type { PlannerEnv } from '../../server/agent-planner';
import { createPlaygroundEngine } from '../../server/engine-config';
import { createDemoOpenaiChat } from '../../server/engine-model';
import { createRedactingLogger, redact } from '../../server/redact';

// A generous cap intended to make OpenAI's response.incomplete truncation
// unlikely for a verbose layout response, not to guarantee it never happens
// — max_output_tokens is shared between reasoning and visible output, so the
// real headroom for the layout JSON is smaller than this number suggests. If
// truncation does happen, @tanstack/ai currently swallows it into a generic
// "structured output finalization produced no result" rather than surfacing
// the incomplete-response reason.
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

/**
 * The factory layer. PROTOTYPE (MAE-826): `env` is the Worker's string
 * bindings, so `AGENT_PLANNER` and the light tier's TypeSafe settings reach
 * the Planner as they do locally.
 */
export const engineFactoryLive = (
  env: PlannerEnv = {},
): Layer.Layer<EngineFactory> =>
  Layer.effect(
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
              env,
            }),
          catch: (cause) =>
            new EngineBuildError({ message: redact(cause, apiKey).message }),
        });
      });

      return EngineFactory.of({ make });
    }),
  );
