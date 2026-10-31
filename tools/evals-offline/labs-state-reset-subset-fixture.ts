import {
  type LabsStateResetSubsetData,
  type LabsStateResetSubsetExpectations,
  type LabsStateResetSubsetInputs,
  type LabsStateResetSubsetResponse,
  type LabsStateResetSubsetState,
  labsStateResetSubsetDataSchema,
  labsStateResetSubsetExpectationsSchema,
  labsStateResetSubsetInputsSchema,
  labsStateResetSubsetObservationSchema,
} from '../../packages/evals/src/adapters/legacy-labs-state-reset-subset.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Two-turn synthetic evidence; no third-turn marker behavior. */
export type LabsStateResetSubsetTurn = SessionTurn<
  LabsStateResetSubsetState,
  LabsStateResetSubsetInputs['turns'][number],
  LabsStateResetSubsetResponse
>;

/** Complete D33 two-prompt output predicate, not full T12/F03a compatibility. */
export function scoreLabsStateResetSubset(
  turns: unknown,
  inputs: LabsStateResetSubsetInputs,
  expected: LabsStateResetSubsetExpectations,
): Verdict {
  const parsed = labsStateResetSubsetObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected two complete, structurally valid turns'],
    };
  const failures: string[] = [];
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    if (
      !turn.output.executionPlan.some(
        (step) =>
          step.instanceId === expected.instanceId &&
          step.action === expected.actions[index],
      )
    )
      failures.push(`Turn ${index} is missing the expected navigation Action`);
    if (turn.output.layout.type !== 'tiling')
      failures.push(`Turn ${index} requires tiling layout evidence`);
    // Preserve source first-match behavior; duplicate membership is not rejected.
    const target = turn.output.layout.instances.find(
      (item) => item.instanceId === expected.instanceId,
    );
    if (!target || target.variant !== expected.variants[index])
      failures.push(`Turn ${index} is missing the expected layout Variant`);
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent responses without interpreting prompts or executing Actions. */
export function legacyLabsStateResetSubset(
  fixture: LabsStateResetSubsetData,
  requests: LabsStateResetSubsetInputs,
  expectations: LabsStateResetSubsetExpectations,
) {
  const data = labsStateResetSubsetDataSchema.parse(fixture);
  const inputs = labsStateResetSubsetInputsSchema.parse(requests);
  const expected = labsStateResetSubsetExpectationsSchema.parse(expectations);
  return sessionAdapter<
    LabsStateResetSubsetState,
    LabsStateResetSubsetInputs['turns'][number],
    LabsStateResetSubsetResponse
  >({
    provenance:
      'synthetic COMPLETE D33 two-prompt predicate; third-turn post-reset/optional enum checks belong to separate synthetic cases; no Engine, provider, LLM, handler or legacy-runtime verification',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreLabsStateResetSubset(turns, inputs, expected),
  });
}
