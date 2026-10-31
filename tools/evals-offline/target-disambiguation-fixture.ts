import {
  type TargetDisambiguationData,
  type TargetDisambiguationExpectations,
  type TargetDisambiguationInput,
  type TargetDisambiguationInputs,
  type TargetDisambiguationResponse,
  type TargetDisambiguationState,
  targetDisambiguationDataSchema,
  targetDisambiguationExpectationsSchema,
  targetDisambiguationInputsSchema,
  targetDisambiguationObservationSchema,
} from '../../packages/evals/src/adapters/legacy-target-disambiguation.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Full structural turn evidence, not natural-language disambiguation evidence. */
export type TargetDisambiguationTurn = SessionTurn<
  TargetDisambiguationState,
  TargetDisambiguationInput,
  TargetDisambiguationResponse
>;

function matchesState(
  state: TargetDisambiguationState,
  expected: TargetDisambiguationExpectations,
  weatherVariant: string,
): boolean {
  const calendar = expected.unchangedInstances[0];
  const matches = (items: TargetDisambiguationState['instances']) =>
    items.length === 2 &&
    items.some(
      (item) =>
        item.instanceId === expected.instanceId &&
        item.vesselId === 'weather' &&
        item.variant === weatherVariant,
    ) &&
    items.some(
      (item) =>
        item.instanceId === calendar.instanceId &&
        item.vesselId === 'calendar' &&
        item.variant === calendar.variant,
    );
  return (
    matches(state.instances) &&
    state.layout.type === 'tiling' &&
    matches(state.layout.instances)
  );
}

/** Strengthened structural trajectory; late Weather Actions are not checked for effects/validity. */
export function scoreTargetDisambiguation(
  turns: unknown,
  data: TargetDisambiguationData,
  inputs: TargetDisambiguationInputs,
  expected: TargetDisambiguationExpectations,
): Verdict {
  const parsed = targetDisambiguationObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected four complete, structurally valid turns'],
    };
  const failures: string[] = [];
  if (!matchesState(data.initial, expected, 'current'))
    failures.push('Expected targets do not match initial Weather/Calendar');
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    const before = index < 3 ? 'current' : expected.variant;
    const after = index < 2 ? 'current' : expected.variant;
    if (!matchesState(turn.state, expected, before))
      failures.push(`Turn ${index} lost prior state or tiling membership`);
    if (!matchesState(turn.output, expected, after))
      failures.push(
        `Turn ${index} has wrong response state or tiling membership`,
      );
    if (!matchesState(turn.resultingState, expected, after))
      failures.push(`Turn ${index} lost resulting state or tiling membership`);
    const plan = turn.output.executionPlan;
    if (plan.some((step) => step.instanceId === expected.forbidActionsOn[0]))
      failures.push(`Turn ${index} contains a forbidden Calendar Action`);
    if (
      plan.some(
        (step) =>
          step.instanceId !== expected.instanceId &&
          step.instanceId !== expected.forbidActionsOn[0],
      )
    )
      failures.push(`Turn ${index} has a foreign Action target`);
    if (index < 2 && plan.length)
      failures.push(`Turn ${index} must not contain premature Actions`);
    if (
      index === 2 &&
      !plan.some(
        (step) =>
          step.instanceId === expected.instanceId &&
          step.action === expected.action,
      )
    )
      failures.push('Turn 2 is missing the decisive weekly Action');
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Replays independent observations; never invokes an Engine, judge or Action handler. */
export function legacyTargetDisambiguation(
  fixture: TargetDisambiguationData,
  requests: TargetDisambiguationInputs,
  expectations: TargetDisambiguationExpectations,
) {
  const data = targetDisambiguationDataSchema.parse(fixture);
  const inputs = targetDisambiguationInputsSchema.parse(requests);
  const expected = targetDisambiguationExpectationsSchema.parse(expectations);
  return sessionAdapter<
    TargetDisambiguationState,
    TargetDisambiguationInput,
    TargetDisambiguationResponse
  >({
    provenance:
      'synthetic legacy-derived D24 structural target isolation; strengthened rubric, language understanding and engine-old unverified',
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
    score: (turns) => scoreTargetDisambiguation(turns, data, inputs, expected),
  });
}
