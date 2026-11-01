import { isDeepStrictEqual } from 'node:util';
import {
  validateWeatherTransitionChain,
  type WeatherTransitionChainData,
  type WeatherTransitionChainExpectations,
  type WeatherTransitionChainInputs,
  weatherNavigationTransitions,
  weatherTransitionChainDataSchema,
  weatherTransitionChainExpectationsSchema,
  weatherTransitionChainInputsSchema,
  weatherTransitionChainObservationSchema,
} from '../../packages/evals/src/adapters/legacy-weather-transition-chain.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

/** Exact planned navigation and membership continuity, not Engine or handler execution. */
export function scoreWeatherTransitionChain(
  turns: unknown,
  requests: WeatherTransitionChainInputs,
  expectations: WeatherTransitionChainExpectations,
): Verdict {
  const parsed = weatherTransitionChainObservationSchema.safeParse(turns);
  const inputs = weatherTransitionChainInputsSchema.safeParse(requests);
  const expected =
    weatherTransitionChainExpectationsSchema.safeParse(expectations);
  if (!parsed.success || !inputs.success || !expected.success)
    return {
      outcome: 'fail',
      failures: [
        'Missing or malformed three-turn Weather evidence or contract',
      ],
    };
  try {
    validateWeatherTransitionChain(inputs.data, expected.data);
  } catch {
    return { outcome: 'fail', failures: ['Changed source trajectory'] };
  }
  const failures: string[] = [];
  const layout = (variant: string) => ({
    type: 'tiling',
    instances: [
      { instanceId: expected.data.instanceId, vesselId: 'weather', variant },
    ],
  });
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.data.turns[index].intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    const before = index === 0 ? 'current' : expected.data.variants[index - 1];
    const after = expected.data.variants[index];
    if (!isDeepStrictEqual(turn.state.layout, layout(before)))
      failures.push(`Turn ${index} changed incoming membership or Variant`);
    if (
      !isDeepStrictEqual(turn.output.executionPlan, [
        {
          instanceId: expected.data.instanceId,
          action: expected.data.actions[index],
        },
      ])
    )
      failures.push(
        `Turn ${index} requires exactly its intended Action without parameters`,
      );
    for (const step of turn.output.executionPlan) {
      const incoming = turn.state.layout.instances.find(
        (item) => item.instanceId === step.instanceId,
      );
      const transitions =
        weatherNavigationTransitions[
          incoming?.variant as keyof typeof weatherNavigationTransitions
        ];
      const target = transitions?.[step.action as keyof typeof transitions];
      if (!incoming || incoming.vesselId !== 'weather' || target !== after)
        failures.push(
          `Turn ${index} Action is invalid for its incoming Variant or destination`,
        );
    }
    if (!isDeepStrictEqual(turn.output.layout, layout(after)))
      failures.push(`Turn ${index} changed output membership or Variant`);
    if (!isDeepStrictEqual(turn.resultingState.layout, turn.output.layout))
      failures.push(`Turn ${index} did not retain its observed state`);
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent response JSON through the common session lifecycle, without applying Actions. */
export function legacyWeatherTransitionChain(
  fixture: WeatherTransitionChainData,
  requests: WeatherTransitionChainInputs,
  expectations: WeatherTransitionChainExpectations,
) {
  const data = weatherTransitionChainDataSchema.parse(fixture);
  const inputs = weatherTransitionChainInputsSchema.parse(requests);
  const expected = weatherTransitionChainExpectationsSchema.parse(expectations);
  validateWeatherTransitionChain(inputs, expected);
  return sessionAdapter({
    provenance:
      'synthetic COMPLETE dataset-aligned Weather transition chain; exact scripted Action emission and membership continuity; D40 corrects legacy scorer sequence drift, D41 strengthens empty-plan allowance; no Engine, provider, model, handler or legacy-runtime compatibility claim',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const output = structuredClone(data.responses[history.length]);
      return { output, state: { layout: structuredClone(output.layout) } };
    },
    score: (turns) => scoreWeatherTransitionChain(turns, inputs, expected),
  });
}
