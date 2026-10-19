import {
  type WeatherReuseData,
  type WeatherReuseExpectations,
  type WeatherReuseInput,
  type WeatherReuseInputs,
  type WeatherReuseResponse,
  type WeatherReuseState,
  weatherReuseDataSchema,
  weatherReuseExpectationsSchema,
  weatherReuseInputsSchema,
  weatherReuseObservationSchema,
} from '../../packages/evals/src/adapters/legacy-weather-reuse.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Complete per-turn evidence, including the state retained after the final turn. */
export type WeatherReuseTurn = SessionTurn<
  WeatherReuseState,
  WeatherReuseInput,
  WeatherReuseResponse
>;

function matchesState(
  state: WeatherReuseState,
  instanceId: string,
  variant: string,
): boolean {
  const matches = (items: WeatherReuseState['instances']) =>
    items.length === 1 &&
    items[0]?.instanceId === instanceId &&
    items[0]?.vesselId === 'weather' &&
    items[0]?.variant === variant;
  return (
    matches(state.instances) &&
    state.layout.type === 'tiling' &&
    matches(state.layout.instances)
  );
}

/** Narrow trajectory oracle; late same-target Actions do not certify Action validity/effects. */
export function scoreWeatherReuse(
  turns: unknown,
  data: WeatherReuseData,
  inputs: WeatherReuseInputs,
  expected: WeatherReuseExpectations,
): Verdict {
  const parsed = weatherReuseObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected four complete, structurally valid turns'],
    };
  const failures: string[] = [];
  if (!matchesState(data.initial, expected.instanceId, 'current'))
    failures.push('Expected target does not match initial current Weather');
  let priorVariant = 'current';
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    if (!matchesState(turn.state, expected.instanceId, priorVariant))
      failures.push(`Turn ${index} lost prior state or tiling membership`);
    const plan = turn.output.executionPlan;
    if (plan.some((step) => step.instanceId !== expected.instanceId))
      failures.push(`Turn ${index} has a foreign Action target`);
    let variant: string = expected.variant;
    if (index === 0) {
      variant = plan.length === 0 ? 'current' : 'hourly';
      if (
        plan.length !== 0 &&
        (plan.length !== 1 || plan[0]?.action !== 'showHourly')
      )
        failures.push('Turn 0 must preserve current or perform showHourly');
    } else if (
      index === 1 &&
      !plan.some(
        (step) =>
          step.instanceId === expected.instanceId &&
          step.action === expected.action,
      )
    )
      failures.push('Turn 1 is missing the decisive weekly Action');
    if (!matchesState(turn.output, expected.instanceId, variant))
      failures.push(
        `Turn ${index} has wrong response state or tiling membership`,
      );
    if (!matchesState(turn.resultingState, expected.instanceId, variant))
      failures.push(`Turn ${index} lost resulting state or tiling membership`);
    priorVariant = variant;
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Replays fixture observations without interpreting prompts or executing Actions. */
export function legacyWeatherReuse(
  fixture: WeatherReuseData,
  requests: WeatherReuseInputs,
  expectations: WeatherReuseExpectations,
) {
  const data = weatherReuseDataSchema.parse(fixture);
  const inputs = weatherReuseInputsSchema.parse(requests);
  const expected = weatherReuseExpectationsSchema.parse(expectations);
  return sessionAdapter<
    WeatherReuseState,
    WeatherReuseInput,
    WeatherReuseResponse
  >({
    provenance:
      'synthetic legacy-derived D22 weather reuse; scripted, engine-old unverified',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: {
          instances: structuredClone(response.instances),
          layout: structuredClone(response.layout),
        },
      };
    },
    score: (turns) => scoreWeatherReuse(turns, data, inputs, expected),
  });
}
