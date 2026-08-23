import { Effect } from 'effect';

/**
 * Runs one server effect and converts its typed failure into a Response at
 * this transport boundary, so handlers stay thin decision tables.
 */
export async function runOrErrorResponse<A, E>(
  effect: Effect.Effect<A, E>,
  toResponse: (error: E) => Response,
): Promise<Response | A> {
  return Effect.runPromise(
    Effect.catch(effect, (error) => Effect.succeed(toResponse(error))),
  );
}
