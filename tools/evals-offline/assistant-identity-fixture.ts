import {
  type AssistantIdentityData,
  type AssistantIdentityExpectations,
  type AssistantIdentityInputs,
  type AssistantIdentityResponse,
  assistantIdentityDataSchema,
  assistantIdentityExpectationsSchema,
  assistantIdentityInputsSchema,
  assistantIdentityObservationSchema,
} from '../../packages/evals/src/adapters/legacy-assistant-identity.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

/** Literal case-insensitive substring checks, not a semantic identity classifier. */
export function scoreAssistantIdentity(
  turns: unknown,
  inputs: AssistantIdentityInputs,
  expectations: AssistantIdentityExpectations,
): Verdict {
  const parsed = assistantIdentityObservationSchema.safeParse(turns);
  const input = assistantIdentityInputsSchema.safeParse(inputs);
  const expected = assistantIdentityExpectationsSchema.safeParse(expectations);
  if (!parsed.success || !input.success || !expected.success)
    return {
      outcome: 'fail',
      failures: [
        'Missing or malformed assistant-identity evidence or contract',
      ],
    };
  const failures: string[] = [];
  const contract = expected.data;
  for (let index = 0; index < contract.expectedTurns; index++) {
    const turn = parsed.data[index];
    if (
      turn.index !== index ||
      turn.input.intent !== input.data.turns[index].intent
    )
      failures.push(`Changed source prompt or sequence at turn ${index}`);
    const text = turn.output.assistantText;
    if (contract.requireNonemptyText && !text.trim())
      failures.push(`Empty assistant text at turn ${index}`);
    if (!text.toLowerCase().includes(contract.requiredIdentity.toLowerCase()))
      failures.push(`Required identity missing at turn ${index}`);
    if (text.toLowerCase().includes(contract.forbiddenIdentity.toLowerCase()))
      failures.push(`Forbidden identity present at turn ${index}`);
    if (turn.output.executionPlan.length !== contract.executionPlanLength)
      failures.push(`Unexpected Execution Plan at turn ${index}`);
    if (turn.output.layout.type !== contract.layoutType)
      failures.push(`Unexpected layout type at turn ${index}`);
    if (turn.output.layout.instances.length !== contract.layoutInstanceCount)
      failures.push(`Unexpected layout Instance count at turn ${index}`);
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies a three-turn script through the common lifecycle without applying a system prompt. */
export function legacyAssistantIdentity(
  fixture: AssistantIdentityData,
  requests: AssistantIdentityInputs,
  expectations: AssistantIdentityExpectations,
) {
  const data = assistantIdentityDataSchema.parse(fixture);
  const inputs = assistantIdentityInputsSchema.parse(requests);
  const expected = assistantIdentityExpectationsSchema.parse(expectations);
  return sessionAdapter<
    Record<string, never>,
    AssistantIdentityInputs['turns'][number],
    AssistantIdentityResponse
  >({
    provenance:
      'synthetic COMPLETE D02 source identity-response predicate; prompt application and semantic persistence are not inferred from this script; no model, prompt effectiveness, provider or runtime compatibility claim',
    inputs: inputs.turns,
    initialize: () => ({}),
    async step(_input, _state, history) {
      return {
        output: structuredClone(data.responses[history.length]),
        state: {},
      };
    },
    score: (turns) => scoreAssistantIdentity(turns, inputs, expected),
  });
}
