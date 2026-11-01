import {
  type ConstraintResponse,
  constraintDataSchema,
  constraintExpectationsSchema,
  constraintInputsSchema,
  constraintResponseSchema,
  type ResponseConstraintData,
  type ResponseConstraintExpectations,
  type ResponseConstraintInput,
  validateResponseConstraint,
} from '../../packages/evals/src/adapters/legacy-response-constraint.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

type State = Pick<ConstraintResponse, 'instances'>;
export type ResponseConstraintTurn = SessionTurn<
  State,
  ResponseConstraintInput,
  ConstraintResponse
>;

function sameInstances(
  actual: State['instances'],
  expected: State['instances'],
): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual.map((item) => item.instanceId)).size === actual.length &&
    expected.every((item) =>
      actual.some(
        (candidate) =>
          candidate.instanceId === item.instanceId &&
          candidate.vesselId === item.vesselId &&
          candidate.variant === item.variant,
      ),
    )
  );
}

/** Enum safety permits absence of a matching Action; it does not prove positive selection. */
export function scoreResponseConstraint(
  turns: readonly ResponseConstraintTurn[],
  data: ResponseConstraintData,
  input: ResponseConstraintInput,
  expected: ResponseConstraintExpectations,
): Verdict {
  const failures: string[] = [];
  const turn = turns[0];
  if (turns.length !== 1 || !turn)
    return {
      outcome: 'fail',
      failures: ['Expected exactly one completed turn'],
    };
  if (turn.index !== 0 || turn.input.intent !== input.intent)
    failures.push('Changed input or turn sequence');
  if (!sameInstances(turn.state.instances, data.instances))
    failures.push('Changed initial state');
  const parsed = constraintResponseSchema.safeParse(turn.output);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: [...failures, 'Missing or malformed response evidence'],
    };
  const response = parsed.data;
  if (expected.rule === 'marker-enum') {
    if (data.vesselId !== 'labs') throw new Error('Incompatible enum fixture');
    for (const [index, step] of response.executionPlan.entries()) {
      if (step.action !== 'selectMarker') continue;
      const slug = step.params?.markerSlug;
      if (typeof slug !== 'string' || !data.markerSlugs.includes(slug))
        failures.push(`Action ${index} has an invalid markerSlug`);
    }
  } else {
    if (data.vesselId !== 'weather')
      throw new Error('Incompatible state fixture');
    if (expected.rule === 'no-op' || expected.rule === 'no-op-tiling') {
      if (response.executionPlan.length)
        failures.push('No-op response must not contain Actions');
    }
    if (expected.rule !== 'no-op') {
      if (response.layout?.type !== 'tiling')
        failures.push('Expected tiling layout evidence');
      else if (!sameInstances(response.layout.instances, data.instances))
        failures.push('Tiling layout changed initial Instance state');
    }
    if (expected.rule === 'valid-actions-preserve-state') {
      for (const [index, step] of response.executionPlan.entries()) {
        const target = data.instances.find(
          (item) => item.instanceId === step.instanceId,
        );
        const source = data.variants.find(
          (item) => item.name === target?.variant,
        );
        if (!target || !source?.actions.includes(step.action))
          failures.push(
            `Action ${index} is unavailable on its source Instance/Variant`,
          );
      }
    }
    if (!response.assistantText.trim())
      failures.push('Assistant text is empty');
    if (!sameInstances(response.instances, data.instances))
      failures.push('Response changed initial Instance state');
    if (!sameInstances(turn.resultingState.instances, data.instances))
      failures.push('Retained state changed initial Instance state');
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies declared synthetic response evidence; never plans an intent or executes an Action. */
export function legacyResponseConstraint(
  fixture: ResponseConstraintData,
  inputs: ResponseConstraintInput,
  expectations: ResponseConstraintExpectations,
) {
  const data = constraintDataSchema.parse(fixture);
  const input = constraintInputsSchema.parse(inputs);
  const expected = constraintExpectationsSchema.parse(expectations);
  validateResponseConstraint(data, expected);
  return sessionAdapter<State, ResponseConstraintInput, ConstraintResponse>({
    provenance:
      'synthetic legacy-derived response constraint; scripted, engine-old unverified',
    inputs: [input],
    initialize: () => ({ instances: data.instances }),
    async step(stimulus) {
      const response = structuredClone(stimulus.response);
      return {
        state: { instances: structuredClone(response.instances) },
        output: response,
      };
    },
    score: (turns) => scoreResponseConstraint(turns, data, input, expected),
  });
}
