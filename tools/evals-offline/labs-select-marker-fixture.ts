import {
  type LabsSelectMarkerData,
  type LabsSelectMarkerExpectations,
  type LabsSelectMarkerInput,
  type LabsSelectMarkerInputs,
  type LabsSelectMarkerResponse,
  type LabsSelectMarkerState,
  labsSelectMarkerDataSchema,
  labsSelectMarkerExpectationsSchema,
  labsSelectMarkerInputsSchema,
  labsSelectMarkerObservationSchema,
} from '../../packages/evals/src/adapters/legacy-labs-select-marker.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Session evidence; retained layouts do not establish retained marker selection. */
export type LabsSelectMarkerTurn = SessionTurn<
  LabsSelectMarkerState,
  LabsSelectMarkerInput,
  LabsSelectMarkerResponse
>;

/** Preserves the source scorer's asymmetric turn checks; retained state is not scored. */
export function scoreLabsSelectMarker(
  turns: unknown,
  inputs: LabsSelectMarkerInputs,
  expected: LabsSelectMarkerExpectations,
): Verdict {
  const parsed = labsSelectMarkerObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected four complete, structurally valid turns'],
    };
  const failures: string[] = [];
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    const response = turn.output;
    if (index === 1) {
      if (
        !response.executionPlan.some(
          (step) =>
            step.instanceId === expected.instanceId &&
            step.action === expected.action &&
            typeof step.params?.markerSlug === 'string' &&
            step.params.markerSlug === expected.markerSlug,
        )
      )
        failures.push('Turn 1 is missing the expected marker selection Action');
      continue;
    }
    if (response.layout.type !== 'tiling')
      failures.push(`Turn ${index} requires tiling layout evidence`);
    if (
      response.executionPlan.some((step) =>
        expected.forbiddenActions.some((action) => action === step.action),
      )
    )
      failures.push(`Turn ${index} contains forbidden navigation`);
    const target = response.layout.instances.find(
      (item) => item.instanceId === expected.instanceId,
    );
    if (!target || target.variant !== expected.variant)
      failures.push(`Turn ${index} is missing the expected trends Instance`);
    if (expected.forbidNewInstances && response.layout.instances.length !== 1)
      failures.push(`Turn ${index} must contain exactly one layout Instance`);
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies fixture responses; neither prompt understanding nor Action effects are executed. */
export function legacyLabsSelectMarker(
  fixture: LabsSelectMarkerData,
  requests: LabsSelectMarkerInputs,
  expectations: LabsSelectMarkerExpectations,
) {
  const data = labsSelectMarkerDataSchema.parse(fixture);
  const inputs = labsSelectMarkerInputsSchema.parse(requests);
  const expected = labsSelectMarkerExpectationsSchema.parse(expectations);
  return sessionAdapter<
    LabsSelectMarkerState,
    LabsSelectMarkerInput,
    LabsSelectMarkerResponse
  >({
    provenance:
      'synthetic legacy-derived D23 marker Action emission; scripted, marker persistence and engine-old unverified',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreLabsSelectMarker(turns, inputs, expected),
  });
}
