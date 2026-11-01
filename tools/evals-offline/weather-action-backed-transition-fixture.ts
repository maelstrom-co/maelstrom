import { isDeepStrictEqual } from 'node:util';
import {
  scoreWeatherActionBackedResponse,
  type WeatherActionBackedData,
  type WeatherActionBackedExpectations,
  type WeatherActionBackedInputs,
  weatherActionBackedDataSchema,
  weatherActionBackedExpectationsSchema,
  weatherActionBackedInputsSchema,
  weatherActionBackedObservationSchema,
} from '../../packages/evals/src/adapters/weather-action-backed-transition.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

/** Checks complete independent evidence before the shared D39 response predicate. */
export function scoreWeatherActionBackedTransition(turns: unknown): Verdict {
  const parsed = weatherActionBackedObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected one complete D39 turn from Weather/current'],
    };
  const turn = parsed.data[0];
  const verdict = scoreWeatherActionBackedResponse(turn.output);
  const failures = [...verdict.failures];
  if (!isDeepStrictEqual(turn.resultingState.layout, turn.output.layout))
    failures.push('D39 retained snapshot differs from the observed layout');
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies an independent candidate; never simulates the requested Action from expectations. */
export function weatherActionBackedTransition(
  fixture: WeatherActionBackedData,
  requests: WeatherActionBackedInputs,
  expectations: WeatherActionBackedExpectations,
) {
  const data = weatherActionBackedDataSchema.parse(fixture);
  const inputs = weatherActionBackedInputsSchema.parse(requests);
  weatherActionBackedExpectationsSchema.parse(expectations);
  return sessionAdapter({
    provenance:
      'synthetic COMPLETE D39 action-backed current-to-weekly predicate; matching Action strengthens legacy nonempty-plan check; unrelated Actions/parameters and geometry unscored; no model, handler or legacy-runtime claim',
    inputs: [inputs],
    initialize: () => structuredClone(data.initial),
    async step() {
      const output = structuredClone(data.response);
      return { output, state: { layout: structuredClone(output.layout) } };
    },
    score: scoreWeatherActionBackedTransition,
  });
}
