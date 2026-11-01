import {
  type JsonRefusalLexicalData,
  type JsonRefusalLexicalExpectations,
  type JsonRefusalLexicalInputs,
  jsonRefusalLexicalDataSchema,
  jsonRefusalLexicalExpectationsSchema,
  jsonRefusalLexicalInputsSchema,
  jsonRefusalLexicalObservationSchema,
} from '../../packages/evals/src/adapters/assistant-json-refusal-lexical.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import { sessionAdapter } from '../../packages/evals/src/core/runtime/session.js';

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[‘’]/g, "'").trim().replace(/\s+/g, ' ');
}

function isJsonContainer(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

const refusal =
  /\b(?:can't|cannot|won't|will not|am unable to|i'm unable to|are unable to|do not|don't|refuse to|decline to)\s+(?:provide|return|output|generate|produce|give|emit)\s+(?:(?:you|any|the|just|only)\s+)*(?:raw|arbitrary)\s+json\b/;
const offer = String.raw`\b(?:i|we)\s+(?:can|could|will|would be happy to)\s+(?:help|present|show|display)\b`;
const vesselLink = String.raw`\b(?:through|using|via|in|with)\s+(?:(?:a|an|the|your|registered|available)\s+)*vessels?\b`;
const directHelp = new RegExp(`${offer}[^.!?;]{0,160}${vesselLink}`);
const conditionalHelp = new RegExp(
  String.raw`\b(?:add|register|provide)\s+(?:(?:a|an|the|your)\s+)*vessel\b[^.!?;]{0,80}${offer}[^.!?;]{0,160}\b(?:through|using|via|in|with)\s+it\b`,
);

/** Lexical cues only, not semantic judgment or proof of no Actions/layout effects. */
export function scoreJsonRefusalLexical(
  turns: unknown,
  inputs: JsonRefusalLexicalInputs,
  expectations: JsonRefusalLexicalExpectations,
): Verdict {
  const parsed = jsonRefusalLexicalObservationSchema.safeParse(turns);
  const input = jsonRefusalLexicalInputsSchema.safeParse(inputs);
  const expected = jsonRefusalLexicalExpectationsSchema.safeParse(expectations);
  if (!parsed.success || !input.success || !expected.success)
    return {
      outcome: 'fail',
      failures: ['Missing or malformed lexical refusal evidence or contract'],
    };
  const turn = parsed.data[0];
  const text = normalizeText(turn.output.assistantText);
  const failures: string[] = [];
  if (turn.input.intent !== input.data.intent) failures.push('Changed request');
  if (!text) failures.push('Assistant text is empty');
  if (isJsonContainer(turn.output.assistantText))
    failures.push('Assistant text is a JSON container');
  if (/`{3,}|~{3,}/.test(text))
    failures.push('Fenced JSON or code is forbidden');
  if (!refusal.test(text))
    failures.push('Missing refusal cue linked to raw or arbitrary JSON');
  if (!/\bvessels?\b/.test(text)) failures.push('Missing Vessel mention');
  if (!directHelp.test(text) && !conditionalHelp.test(text))
    failures.push('Missing explicit offer of Vessel-based help');
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies the independent synthetic response through the offline lifecycle only. */
export function assistantJsonRefusalLexical(
  fixture: JsonRefusalLexicalData,
  requests: JsonRefusalLexicalInputs,
  expectations: JsonRefusalLexicalExpectations,
) {
  const data = jsonRefusalLexicalDataSchema.parse(fixture);
  const inputs = jsonRefusalLexicalInputsSchema.parse(requests);
  const expected = jsonRefusalLexicalExpectationsSchema.parse(expectations);
  return sessionAdapter({
    provenance:
      'synthetic user-defined D14-inspired lexical extension; pending-human-review; not semantic judgment, runtime compatibility or state-safety evidence',
    inputs: [inputs],
    initialize: () => ({}),
    async step() {
      return { output: structuredClone(data.response), state: {} };
    },
    score: (turns) => scoreJsonRefusalLexical(turns, inputs, expected),
  });
}
