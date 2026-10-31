import {
  type HistoryAssistantInjectionData,
  type HistoryAssistantInjectionExpectations,
  type HistoryAssistantInjectionInputs,
  type HistoryAssistantInjectionResponse,
  type HistoryAssistantInjectionState,
  historyAssistantInjectionDataSchema,
  historyAssistantInjectionExpectationsSchema,
  historyAssistantInjectionInputsSchema,
  historyAssistantInjectionObservationSchema,
} from '../../packages/evals/src/adapters/legacy-history-assistant-injection.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

/** Ordinary Weather response predicate only; neither semantic dependence on prior assistant content nor prompt injection/security is tested. */
export function scoreHistoryAssistantInjection(
  turns: unknown,
  inputs: HistoryAssistantInjectionInputs,
  expectations: HistoryAssistantInjectionExpectations,
): Verdict {
  const parsed = historyAssistantInjectionObservationSchema.safeParse(turns);
  const input = historyAssistantInjectionInputsSchema.safeParse(inputs);
  const expected =
    historyAssistantInjectionExpectationsSchema.safeParse(expectations);
  if (!parsed.success || !input.success || !expected.success)
    return {
      outcome: 'fail',
      failures: [
        'Missing or malformed history-assistant-injection evidence or contract',
      ],
    };
  const failures: string[] = [];
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== input.data.turns[index].intent
    )
      failures.push(`Changed source prompt or sequence at turn ${index}`);
    const response = turn.output;
    if (index < 2 && !response.assistantText?.trim())
      failures.push(`Empty assistant text at turn ${index}`);
    if (index === 1) {
      if (
        !response.executionPlan.some(
          (step) =>
            step.instanceId === expected.data.instanceId &&
            step.action === expected.data.action,
        )
      )
        failures.push('Turn 1 missing showHourly on weather-main');
      const text = response.assistantText?.toLowerCase() ?? '';
      if (
        !['rain', 'mentioned', 'said'].some((keyword) => text.includes(keyword))
      )
        failures.push('Turn 1 missing contextual keyword');
    } else if (response.executionPlan.length > 0) {
      failures.push(`Unexpected mutation at turn ${index}`);
    }
    if (response.layout.type !== 'tiling')
      failures.push(`Unexpected layout type at turn ${index}`);
    const target = response.layout.instances.find(
      (entry) => entry.instanceId === expected.data.instanceId,
    );
    if (!target || target.variant !== expected.data.variants[index])
      failures.push(`Variant mismatch at turn ${index}`);
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies a response script through the existing session lifecycle without interpreting history. */
export function legacyHistoryAssistantInjection(
  fixture: HistoryAssistantInjectionData,
  requests: HistoryAssistantInjectionInputs,
  expectations: HistoryAssistantInjectionExpectations,
) {
  const data = historyAssistantInjectionDataSchema.parse(fixture);
  const inputs = historyAssistantInjectionInputsSchema.parse(requests);
  const expected =
    historyAssistantInjectionExpectationsSchema.parse(expectations);
  return sessionAdapter<
    HistoryAssistantInjectionState,
    HistoryAssistantInjectionInputs['turns'][number],
    HistoryAssistantInjectionResponse
  >({
    provenance:
      'synthetic COMPLETE D25/T23 scripted ordinary multi-turn Weather conversation-history continuity; no semantic dependence on previous assistant content or prompt injection/security verification; assistant-message injection is out of scope; no AI/model/provider/runtime compatibility claim',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const output = structuredClone(data.responses[history.length]);
      return { output, state: { layout: structuredClone(output.layout) } };
    },
    score: (turns) => scoreHistoryAssistantInjection(turns, inputs, expected),
  });
}
