import {
  type WeatherDelayedActionData,
  type WeatherDelayedActionExpectations,
  type WeatherDelayedActionInput,
  type WeatherDelayedActionInputs,
  type WeatherDelayedActionResponse,
  type WeatherDelayedActionState,
  weatherDelayedActionDataSchema,
  weatherDelayedActionExpectationsSchema,
  weatherDelayedActionInputsSchema,
  weatherDelayedActionObservationSchema,
} from '../../packages/evals/src/adapters/legacy-weather-delayed-action.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Complete per-turn evidence, including the state retained after the final turn. */
export type WeatherDelayedActionTurn = SessionTurn<
  WeatherDelayedActionState,
  WeatherDelayedActionInput,
  WeatherDelayedActionResponse
>;

function matchesState(
  state: WeatherDelayedActionState,
  instanceId: string,
  variant: string,
): boolean {
  const matches = (items: WeatherDelayedActionState['instances']) =>
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

/** Intent-preserving rubric correction; scripted evidence does not certify Action effects. */
export function scoreWeatherDelayedAction(
  turns: unknown,
  data: WeatherDelayedActionData,
  inputs: WeatherDelayedActionInputs,
  expected: WeatherDelayedActionExpectations,
): Verdict {
  const parsed = weatherDelayedActionObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected three complete, structurally valid turns'],
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
    const variant = index < 2 ? 'current' : expected.variant;
    if (index < 2 && plan.length !== 0)
      failures.push(`Turn ${index} must have an empty Execution Plan`);
    if (
      index === 2 &&
      !plan.some(
        (step) =>
          step.instanceId === expected.instanceId &&
          step.action === expected.action,
      )
    )
      failures.push('Turn 2 is missing the decisive weekly Action');
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
export function legacyWeatherDelayedAction(
  fixture: WeatherDelayedActionData,
  requests: WeatherDelayedActionInputs,
  expectations: WeatherDelayedActionExpectations,
) {
  const data = weatherDelayedActionDataSchema.parse(fixture);
  const inputs = weatherDelayedActionInputsSchema.parse(requests);
  const expected = weatherDelayedActionExpectationsSchema.parse(expectations);
  return sessionAdapter<
    WeatherDelayedActionState,
    WeatherDelayedActionInput,
    WeatherDelayedActionResponse
  >({
    provenance:
      'synthetic legacy-derived D32 delayed Weather Action; scripted, engine-old unverified',
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
    score: (turns) => scoreWeatherDelayedAction(turns, data, inputs, expected),
  });
}
