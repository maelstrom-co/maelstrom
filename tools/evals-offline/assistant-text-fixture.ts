import {
  type AssistantTextData,
  type AssistantTextExpectations,
  type AssistantTextInputs,
  type AssistantTextResponse,
  assistantTextDataSchema,
  assistantTextExpectationsSchema,
  assistantTextInputsSchema,
  assistantTextObservationSchema,
} from '../../packages/evals/src/adapters/legacy-assistant-text.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

function normalizeText(value: string): string {
  return value.trim().split(/\s+/).join(' ');
}

function isJsonObjectLike(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

/** Source predicates only: D14 success is not refusal or orchestration redirection. */
export function scoreAssistantText(
  turns: unknown,
  inputs: AssistantTextInputs,
  expectations: AssistantTextExpectations,
): Verdict {
  const parsed = assistantTextObservationSchema.safeParse(turns);
  const input = assistantTextInputsSchema.safeParse(inputs);
  const expected = assistantTextExpectationsSchema.safeParse(expectations);
  if (!parsed.success || !input.success || !expected.success)
    return {
      outcome: 'fail',
      failures: ['Missing or malformed assistant-text evidence or contract'],
    };
  const turn = parsed.data[0];
  const failures: string[] = [];
  if (turn.input.intent !== input.data.intent)
    failures.push('Changed source prompt');
  const text = normalizeText(turn.output.assistantText);
  if (expected.data.rule === 'exact-text') {
    if (text !== normalizeText(expected.data.exactText))
      failures.push('Assistant text does not match normalized exact text');
  } else {
    if (!text) failures.push('Assistant text is empty');
    if (isJsonObjectLike(turn.output.assistantText))
      failures.push('Assistant text is a JSON container');
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies a synthetic candidate through the common lifecycle without any runtime call. */
export function legacyAssistantText(
  fixture: AssistantTextData,
  requests: AssistantTextInputs,
  expectations: AssistantTextExpectations,
) {
  const data = assistantTextDataSchema.parse(fixture);
  const inputs = assistantTextInputsSchema.parse(requests);
  const expected = assistantTextExpectationsSchema.parse(expectations);
  return sessionAdapter<
    Record<string, never>,
    AssistantTextInputs,
    AssistantTextResponse
  >({
    provenance:
      expected.rule === 'exact-text'
        ? 'synthetic D03 source exact-text predicate represented; no shared-ai.chat, streaming or runtime compatibility claim'
        : 'synthetic COMPLETE D14 source text predicate; semantic refusal and Vessel-orchestration redirection are outside this predicate; no semantic success or runtime compatibility claim',
    inputs: [inputs],
    initialize: () => ({}),
    async step() {
      return { output: structuredClone(data.response), state: {} };
    },
    score: (turns) => scoreAssistantText(turns, inputs, expected),
  });
}
