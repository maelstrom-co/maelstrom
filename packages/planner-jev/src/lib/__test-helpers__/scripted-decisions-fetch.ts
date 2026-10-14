import type { AskCall } from '../ask.js';
import { createDecisionsClient } from '../openai-decisions-client.js';
import {
  buildReply,
  failureResponse,
  type Payload,
  type Script,
  type Step,
} from './scripted-fetch.js';

/** The model the scripted Decisions transport echoes. */
export const DECISIONS_TEST_MODEL = 'gpt-6-luna-test';

/** One question of a Decisions request body. */
export interface DecisionsWireQuestion {
  readonly type: 'predicate' | 'choice' | 'score';
  readonly name: string;
  readonly instructions: string;
  readonly choices?: readonly {
    readonly value: string;
    readonly description: string;
  }[];
  readonly levels?: readonly {
    readonly label: string;
    readonly description: string;
  }[];
}

/** The request body the Decisions client sends. */
export interface DecisionsRequest {
  readonly model: string;
  readonly input: string;
  readonly questions: readonly DecisionsWireQuestion[];
}

/**
 * A scripted Decisions step: any TypeSafe {@link Step}, or answers with
 * `refuse` listing the question ids refused; every other question is
 * answered as an answering {@link Step} would answer it.
 */
export type DecisionsStep =
  | Step
  | {
      readonly refuse: readonly string[];
      readonly choices?: Readonly<Record<string, string>>;
      readonly confidence?: number;
      readonly nouls?: Readonly<Record<string, number>>;
      readonly scores?: Readonly<Record<string, number>>;
    };

type AnsweringDecisionsStep =
  | Extract<Step, { readonly choices: unknown }>
  | Extract<DecisionsStep, { readonly refuse: unknown }>;

/** A {@link Script} whose steps may also refuse questions. */
export type DecisionsScript = (payload: Payload, call: number) => DecisionsStep;

/**
 * A fetch that answers Decisions calls from `script`. Each request is
 * decoded back into the TypeSafe-shaped {@link Payload}, so every existing
 * script drives it unchanged, and recorded in `calls`; the raw request
 * bodies are kept in `requests`.
 */
export function scriptedDecisionsFetch(
  script: DecisionsScript | Script,
  model = DECISIONS_TEST_MODEL,
): {
  readonly fetch: typeof fetch;
  readonly calls: Payload[];
  readonly requests: DecisionsRequest[];
} {
  const calls: Payload[] = [];
  const requests: DecisionsRequest[] = [];
  const handler = async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as DecisionsRequest;
    requests.push(request);
    const payload = decisionsPayload(request);
    calls.push(payload);
    const step: DecisionsStep = script(payload, calls.length - 1);
    const failing = failureResponse(step, init?.signal);
    if (failing) return failing;
    const answering = step as AnsweringDecisionsStep;
    return new Response(
      JSON.stringify(
        buildDecisionsReply(payload, {
          choices: answering.choices ?? {},
          confidence: answering.confidence ?? 1,
          model,
          nouls: answering.nouls ?? {},
          scores: answering.scores ?? {},
          refuse: 'refuse' in answering ? answering.refuse : [],
        }),
      ),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch: handler as unknown as typeof fetch, calls, requests };
}

/**
 * Decodes a Decisions request into the TypeSafe-shaped payload: the state
 * parsed from `input` (the text itself when it is not a JSON object, as
 * under a prose render), predicates as nouls, choices with their options as
 * `criteria` and scores with their levels as the `criteria` array. A
 * description or instruction that renders a JSON object is parsed back, so
 * the payload matches the TypeSafe client's under the default render.
 */
export function decisionsPayload(request: DecisionsRequest): Payload {
  const questions: Record<string, unknown> = {};
  for (const question of request.questions) {
    const instructions = unrendered(question.instructions);
    if (question.type === 'predicate')
      questions[question.name] = { type: 'noul', instructions };
    else if (question.type === 'choice')
      questions[question.name] = {
        type: 'choice',
        instructions,
        criteria: Object.fromEntries(
          (question.choices ?? []).map(({ value, description }) => [
            value,
            unrendered(description),
          ]),
        ),
      };
    else
      questions[question.name] = {
        type: 'score',
        instructions,
        criteria: (question.levels ?? []).map(({ description }) =>
          unrendered(description),
        ),
      };
  }
  return {
    model: request.model,
    state: unrendered(request.input),
    questions,
  } as unknown as Payload;
}

/**
 * A valid Decisions reply answering as {@link buildReply} would, in the
 * Decisions wire shape, with each question in `refuse` refused instead.
 */
export function buildDecisionsReply(
  payload: Payload,
  {
    choices = {},
    confidence = 1,
    model = DECISIONS_TEST_MODEL,
    nouls = {},
    scores = {},
    refuse = [],
  }: {
    readonly choices?: Readonly<Record<string, string>>;
    readonly confidence?: number;
    readonly model?: string;
    readonly nouls?: Readonly<Record<string, number>>;
    readonly scores?: Readonly<Record<string, number>>;
    readonly refuse?: readonly string[];
  } = {},
) {
  const typesafe = buildReply(
    payload,
    choices,
    confidence,
    model,
    nouls,
    scores,
  );
  const answers = typesafe.answers as Record<string, Record<string, unknown>>;
  return {
    model,
    answers: Object.keys(payload.questions).map((name) => {
      if (refuse.includes(name)) return { type: 'refusal', name };
      const answer = answers[name] as Record<string, unknown>;
      if (answer.type === 'noul')
        return { type: 'predicate', name, probability: answer.noul };
      const probabilities = answer.probabilities as Record<string, number>;
      if (answer.type === 'score')
        return {
          type: 'score',
          name,
          score: answer.score,
          probabilities: Object.entries(probabilities).map(
            ([level, probability]) => ({
              value: Number(level),
              label: level,
              probability,
            }),
          ),
          confidence: answer.confidence,
        };
      return {
        type: 'choice',
        name,
        choice: answer.choice,
        probabilities: Object.entries(probabilities).map(
          ([value, probability]) => ({ value, probability }),
        ),
        confidence: answer.confidence,
      };
    }),
    usage: {
      input_tokens: 11,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 11,
    },
  };
}

/** A Decisions client answering from `script`, with every payload and call recorded. */
export function scriptedDecisionsAsk(
  script: DecisionsScript | Script,
  options: { timeoutMs?: number } = {},
) {
  const { fetch, calls, requests } = scriptedDecisionsFetch(script);
  const reported: AskCall[] = [];
  const ask = createDecisionsClient({
    apiKey: 'decisions-test-key',
    model: DECISIONS_TEST_MODEL,
    fetch,
    timeoutMs: options.timeoutMs ?? 1000,
    onCall: (call) => reported.push(call),
  });
  return { ask, calls, requests, reported };
}

function unrendered(text: string): unknown {
  if (!text.startsWith('{')) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? parsed : text;
  } catch {
    return text;
  }
}
