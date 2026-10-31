import {
  type CrossVesselData,
  type CrossVesselExpectations,
  type CrossVesselInputs,
  type CrossVesselResponse,
  type CrossVesselState,
  crossVesselDataSchema,
  crossVesselExpectationsSchema,
  crossVesselInputsSchema,
  crossVesselObservationSchema,
} from '../../packages/evals/src/adapters/legacy-cross-vessel.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Complete response evidence, without handler effects or state-continuity guarantees. */
export type CrossVesselTurn = SessionTurn<
  CrossVesselState,
  CrossVesselInputs['turns'][number],
  CrossVesselResponse
>;

/** Dataset-aligned response-only checks; extras and duplicate members use first-match semantics. */
export function scoreCrossVessel(
  turns: unknown,
  data: CrossVesselData,
  inputs: CrossVesselInputs,
  expected: CrossVesselExpectations,
): Verdict {
  const parsed = crossVesselObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected three complete, structurally valid turns'],
    };
  const failures: string[] = [];
  const { weather, calendar, labs } = expected;
  for (const retained of [
    {
      instanceId: weather.instanceId,
      vesselId: weather.vesselId,
      variant: 'current',
    },
    calendar,
  ]) {
    const initial = data.initial.layout.instances.find(
      (item) => item.instanceId === retained.instanceId,
    );
    if (
      !initial ||
      initial.vesselId !== retained.vesselId ||
      initial.variant !== retained.variant
    )
      failures.push('Expected context does not match initial Weather/Calendar');
  }
  if (
    data.initial.layout.instances.some(
      (item) => item.instanceId === labs.instanceId,
    )
  )
    failures.push('Expected Labs identity is not new');
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    const response = turn.output;
    if (response.layout.type !== 'tiling')
      failures.push(`Turn ${index} requires tiling layout evidence`);
    const weatherVariant =
      index === 2 ? weather.finalVariant : weather.hourlyVariant;
    for (const required of [
      {
        instanceId: weather.instanceId,
        vesselId: weather.vesselId,
        variant: weatherVariant,
      },
      calendar,
      ...(index === 0 ? [] : [labs]),
    ]) {
      const target = response.layout.instances.find(
        (item) => item.instanceId === required.instanceId,
      );
      if (
        !target ||
        target.vesselId !== required.vesselId ||
        target.variant !== required.variant
      )
        failures.push(
          `Turn ${index} is missing expected ${required.vesselId}/${required.variant}`,
        );
    }
    if (
      index === 0 &&
      response.layout.instances.some(
        (item) =>
          item.instanceId === labs.instanceId ||
          item.vesselId === labs.vesselId,
      )
    )
      failures.push('Turn 0 must not introduce Labs before the request');
    if (index !== 1) {
      const action = index === 0 ? weather.hourlyAction : weather.finalAction;
      if (
        !response.executionPlan.some(
          (step) =>
            step.instanceId === weather.instanceId && step.action === action,
        )
      )
        failures.push(`Turn ${index} is missing Weather ${action}`);
    }
    const forbiddenTarget = index === 2 ? labs.instanceId : calendar.instanceId;
    if (
      response.executionPlan.some((step) => step.instanceId === forbiddenTarget)
    )
      failures.push(
        `Turn ${index} contains a forbidden ${index === 2 ? 'Labs' : 'Calendar'} Action`,
      );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent observations; no Engine, judge, client or handler runs. */
export function legacyCrossVessel(
  fixture: CrossVesselData,
  requests: CrossVesselInputs,
  expectations: CrossVesselExpectations,
) {
  const data = crossVesselDataSchema.parse(fixture);
  const inputs = crossVesselInputsSchema.parse(requests);
  const expected = crossVesselExpectationsSchema.parse(expectations);
  return sessionAdapter<
    CrossVesselState,
    CrossVesselInputs['turns'][number],
    CrossVesselResponse
  >({
    provenance:
      'synthetic legacy-derived D36 dataset-aligned cross-vessel responses; labs-main/lab-results/trends correction, effects and engine-old unverified',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreCrossVessel(turns, data, inputs, expected),
  });
}
