import {
  type LabsOptionalEnumData,
  type LabsOptionalEnumExpectations,
  type LabsOptionalEnumInputs,
  type LabsOptionalEnumResponse,
  labsOptionalEnumDataSchema,
  labsOptionalEnumExpectationsSchema,
  labsOptionalEnumInputsSchema,
  labsOptionalEnumObservationSchema,
} from '../../packages/evals/src/adapters/labs-state-reset-optional-enum.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

/** Checks only the first matching optional marker Action; later matches are deliberately unscored. */
export function scoreLabsOptionalEnum(
  turns: unknown,
  requests: LabsOptionalEnumInputs,
  expectations: LabsOptionalEnumExpectations,
): Verdict {
  const parsed = labsOptionalEnumObservationSchema.safeParse(turns);
  const inputs = labsOptionalEnumInputsSchema.safeParse(requests);
  const expected = labsOptionalEnumExpectationsSchema.safeParse(expectations);
  if (!parsed.success || !inputs.success || !expected.success)
    return {
      outcome: 'fail',
      failures: [
        'Expected one complete synthetic third-prompt enum projection and valid contract',
      ],
    };
  const failures: string[] = [];
  const turn = parsed.data[0];
  if (turn.input.intent !== inputs.data.intent)
    failures.push('Changed synthetic third prompt');
  const first = turn.output.executionPlan.find(
    (step) =>
      step.instanceId === expected.data.instanceId &&
      step.action === expected.data.action,
  );
  if (first) {
    const params = first.params;
    const slug =
      params !== null && typeof params === 'object' && !Array.isArray(params)
        ? params.markerSlug
        : undefined;
    if (
      typeof slug !== 'string' ||
      !expected.data.allowedMarkerSlugs.some((allowed) => allowed === slug)
    )
      failures.push(
        'First labs-main/selectMarker must have an allowed string markerSlug',
      );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies an independent candidate; no reset simulation, runtime or handler executes. */
export function labsStateResetOptionalEnum(
  fixture: LabsOptionalEnumData,
  requests: LabsOptionalEnumInputs,
  expectations: LabsOptionalEnumExpectations,
) {
  const data = labsOptionalEnumDataSchema.parse(fixture);
  const inputs = labsOptionalEnumInputsSchema.parse(requests);
  const expected = labsOptionalEnumExpectationsSchema.parse(expectations);
  return sessionAdapter<
    Record<string, never>,
    LabsOptionalEnumInputs,
    LabsOptionalEnumResponse
  >({
    provenance:
      'synthetic COMPLETE D33 isolated optional first-match enum predicate; existing synthetic third prompt is absent from the dataset; not a reset session, positive selection, all-match enum safety, handler effect, marker persistence or current-app/runtime compatibility result',
    inputs: [inputs],
    initialize: () => ({}),
    async step() {
      return { output: structuredClone(data.response), state: {} };
    },
    score: (turns) => scoreLabsOptionalEnum(turns, inputs, expected),
  });
}
