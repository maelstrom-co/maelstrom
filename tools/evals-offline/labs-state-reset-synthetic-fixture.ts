import { isDeepStrictEqual } from 'node:util';
import {
  type LabsStateResetSyntheticData,
  type LabsStateResetSyntheticExpectations,
  type LabsStateResetSyntheticInputs,
  labsStateResetSyntheticDataSchema,
  labsStateResetSyntheticExpectationsSchema,
  labsStateResetSyntheticInputsSchema,
  labsStateResetSyntheticObservationSchema,
} from '../../packages/evals/src/adapters/labs-state-reset-synthetic.js';
import type {
  LabsStateResetSubsetResponse,
  LabsStateResetSubsetState,
} from '../../packages/evals/src/adapters/legacy-labs-state-reset-subset.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

/** Exact scripted emission and snapshot continuity, not real marker selection effects. */
export function scoreLabsStateResetSynthetic(
  turns: unknown,
  requests: LabsStateResetSyntheticInputs,
  expectations: LabsStateResetSyntheticExpectations,
): Verdict {
  const parsed = labsStateResetSyntheticObservationSchema.safeParse(turns);
  const inputs = labsStateResetSyntheticInputsSchema.safeParse(requests);
  const expected =
    labsStateResetSyntheticExpectationsSchema.safeParse(expectations);
  if (!parsed.success || !inputs.success || !expected.success)
    return {
      outcome: 'fail',
      failures: [
        'Expected three complete synthetic turns and a valid contract',
      ],
    };
  const failures: string[] = [];
  const layout = (variant: string) => ({
    type: 'tiling',
    instances: [
      { instanceId: expected.data.instanceId, vesselId: 'labs', variant },
    ],
  });
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.data.turns[index].intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    const action = {
      instanceId: expected.data.instanceId,
      action: expected.data.actions[index],
      ...(index === 2
        ? { params: { markerSlug: expected.data.markerSlug } }
        : {}),
    };
    if (!isDeepStrictEqual(turn.output.executionPlan, [action]))
      failures.push(
        `Turn ${index} requires exactly the expected Action and parameters`,
      );
    const before = layout(
      index === 0 ? 'trends' : expected.data.variants[index - 1],
    );
    const after = layout(expected.data.variants[index]);
    if (!isDeepStrictEqual(turn.state.layout, before))
      failures.push(
        `Turn ${index} has inconsistent pre-turn layout membership`,
      );
    if (!isDeepStrictEqual(turn.output.layout, after))
      failures.push(
        `Turn ${index} requires the exact Labs layout membership and Variant`,
      );
    if (!isDeepStrictEqual(turn.resultingState.layout, after))
      failures.push(
        `Turn ${index} has inconsistent retained layout membership`,
      );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies three independent responses without a planner, handler or selected-marker simulation. */
export function labsStateResetSynthetic(
  fixture: LabsStateResetSyntheticData,
  requests: LabsStateResetSyntheticInputs,
  expectations: LabsStateResetSyntheticExpectations,
) {
  const data = labsStateResetSyntheticDataSchema.parse(fixture);
  const inputs = labsStateResetSyntheticInputsSchema.parse(requests);
  const expected =
    labsStateResetSyntheticExpectationsSchema.parse(expectations);
  return sessionAdapter<
    LabsStateResetSubsetState,
    LabsStateResetSyntheticInputs['turns'][number],
    LabsStateResetSubsetResponse
  >({
    provenance:
      'synthetic D33 extension: third prompt absent from dataset; exact scripted Action emission and layout-membership continuity only; COMPLETE for this emission predicate; optional first-match enum safety is a separate case; no Engine, model, provider, handler, marker persistence or current-app/runtime compatibility claim',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const output = structuredClone(data.responses[history.length]);
      return { output, state: { layout: structuredClone(output.layout) } };
    },
    score: (turns) => scoreLabsStateResetSynthetic(turns, inputs, expected),
  });
}
