import { err, isOk, ok, type Result } from '@maelstrom-co/protocol';
import type { WireAnswer } from '@tanstack/ai';

import type { Ask, AskCall } from './ask.js';
import {
  createProviderCall,
  type ProviderQuestion,
  type ProviderRequest,
  type ProviderTransport,
  type TransportReply,
  validateClientOptions,
} from './provider-call.js';
import { type ErrorFieldsExtractor, postJson } from './provider-fetch.js';
import {
  type InvalidReplyReason,
  isCount,
  isRecord,
} from './reply-validation.js';

/** The default Decisions model. */
export const DECISIONS_MODEL = 'gpt-6-luna';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/decisions';

/** Connection settings for OpenAI's Decisions endpoint. */
export interface DecisionsClientOptions {
  /** OpenAI API key. Server-side only; never logged or echoed in errors. */
  readonly apiKey: string;
  /** Decisions model id. Defaults to {@link DECISIONS_MODEL}. */
  readonly model?: string;
  /** Endpoint URL. Defaults to OpenAI's v1 Decisions endpoint. */
  readonly endpoint?: string;
  /** Transport, for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Per-call timeout in milliseconds, combined with the request's signal. Defaults to 5000. */
  readonly timeoutMs?: number;
  /** Called once per call, for instrumentation. */
  readonly onCall?: (call: AskCall) => void;
  /**
   * Logs every parsed reply at debug as `jev.reply`, with the state and
   * questions it answers, all as JSON strings, before validation. Questions
   * and replies can echo user text, so keep it off outside local debugging.
   * Defaults to `false`.
   */
  readonly logReplies?: boolean;
  /**
   * Turns the evaluation's state and every object-valued question text into
   * the text Decisions reads. Strings pass through unchanged. Defaults to
   * `JSON.stringify`.
   */
  readonly render?: (value: unknown) => string;
}

/**
 * An {@link Ask} that sends each evaluation to OpenAI's Decisions API: the
 * state as the `input` text, nouls as predicates, choices as choices with
 * one value per option key and scores with one level per score level,
 * labelled `"0"` upwards. The reply is validated strictly: every question
 * answered exactly once by name with its own answer type, a choice that is
 * the most probable of exactly its options, a score within its levels with
 * its level taken from the most probable one, and integral usage.
 *
 * A refusal of any question defers `provider_refusal` on the first refused
 * question and logs `jev.provider_failure` at warn. A reply that refuses any
 * question is read as a refusal before the completeness and per-answer
 * checks, so its other answers need not be present or valid. A question over
 * the option cap defers `option_cap` before any call; a timeout, network
 * failure, non-2xx status or invalid reply defers with the matching
 * `provider_*` code; a user abort returns a `CancellationError`. Every call
 * logs `jev.call` at debug, emits a `jev.call` instrument event and reaches
 * `onCall`, as the TypeSafe client does.
 *
 * Server-only: the OpenAI key must never reach a browser.
 *
 * @experimental
 * @throws {Error} If an option is invalid. The message never contains the key.
 */
export function createDecisionsClient(options: DecisionsClientOptions): Ask {
  const config = validateClientOptions(
    { ...options, model: options.model ?? DECISIONS_MODEL },
    'Decisions',
    DEFAULT_ENDPOINT,
  );
  if (options.render !== undefined && typeof options.render !== 'function')
    throw new Error('Invalid Decisions option: render must be a function');
  return createProviderCall({
    label: 'Decisions',
    model: config.model,
    timeoutMs: config.timeoutMs,
    onCall: config.onCall,
    logReplies: config.logReplies,
    transport: decisionsTransport({
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      fetch: config.fetch,
      render: options.render ?? ((value: unknown) => JSON.stringify(value)),
    }),
  });
}

/**
 * The transport for OpenAI's Decisions endpoint. It sends the state as the
 * `input` text, nouls as predicates, choices with one value per option key
 * and scores with one level per score level, labelled `"0"` upwards, with
 * `render` applied to the state and every non-string question text. A
 * throwing `render` rejects `send` before anything is sent.
 *
 * It decodes the reply into TanStack wire answers keyed by question id. A
 * reply whose answers are not an array, whose usage counts are not integral,
 * or with an answer that is not an object or has no string name is
 * `malformed_json`. An answer to a question that was not asked, or a second
 * answer to the same question, is `key_mismatch`. Refused questions are
 * listed in `refusals`, and once any question is refused the other answers
 * are kept only where they decode. Otherwise an answer of the wrong kind for
 * its question is `wrong_type`, a choice probability keyed by a non-string
 * value or of an unknown answer type is `malformed_json`, and a repeated
 * probability key or a score probability keyed by anything but a safe
 * integer is `key_mismatch`. The reply need not echo the model. An HTTP
 * failure reads its error type and code from OpenAI's error body,
 * `error.type` and `error.code`.
 */
export function decisionsTransport({
  apiKey,
  endpoint,
  fetch,
  render,
}: {
  /** OpenAI API key. Server-side only. */
  readonly apiKey: string;
  /** Endpoint URL. */
  readonly endpoint: string;
  /** The fetch to send with. */
  readonly fetch: typeof globalThis.fetch;
  /** Turns the state and every non-string question text into text. */
  readonly render: (value: unknown) => string;
}): ProviderTransport {
  return {
    async send(request, signal) {
      const body = JSON.stringify(decisionsRequest(request, render));
      const posted = await postJson({
        fetch,
        endpoint,
        apiKey,
        body,
        signal,
        errorFields: openaiErrorFields,
      });
      if (!posted.ok) return posted;
      const decoded = decodeReply(posted.raw, request.questions);
      if (!isOk(decoded))
        return {
          ok: false,
          failure: { kind: 'invalid_reply', reason: decoded.error },
          raw: posted.raw,
        };
      return { ok: true, reply: { ...decoded.value, raw: posted.raw } };
    },
  };
}

const openaiErrorFields: ErrorFieldsExtractor = (body) =>
  isRecord(body) && isRecord(body.error)
    ? { type: body.error.type, code: body.error.code }
    : {};

const WIRE_KINDS: Readonly<Record<string, ProviderQuestion['type']>> = {
  predicate: 'noul',
  choice: 'choice',
  score: 'score',
};

function decisionsRequest(
  request: ProviderRequest,
  render: (value: unknown) => string,
) {
  const text = (value: unknown) =>
    typeof value === 'string' ? value : render(value);
  return {
    model: request.model,
    input: text(request.state),
    questions: Object.entries(request.questions).map(([name, question]) =>
      decisionsQuestion(name, question, text),
    ),
  };
}

function decisionsQuestion(
  name: string,
  question: ProviderQuestion,
  text: (value: unknown) => string,
) {
  if (question.type === 'noul')
    return {
      type: 'predicate',
      name,
      instructions: text(question.instructions),
    };
  if (question.type === 'score')
    return {
      type: 'score',
      name,
      instructions: text(question.instructions),
      levels: question.criteria.map((description, level) => ({
        label: String(level),
        description: text(description),
      })),
    };
  return {
    type: 'choice',
    name,
    instructions: text(question.instructions),
    choices: Object.entries(question.criteria).map(([value, description]) => ({
      value,
      description: text(description),
    })),
  };
}

function decodeReply(
  raw: unknown,
  questions: Readonly<Record<string, ProviderQuestion>>,
): Result<Omit<TransportReply, 'raw'>, InvalidReplyReason> {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.answers) ||
    !isRecord(raw.usage) ||
    !isCount(raw.usage.input_tokens) ||
    !isCount(raw.usage.output_tokens)
  )
    return err('malformed_json');
  const usage = {
    inputTokens: raw.usage.input_tokens,
    outputTokens: raw.usage.output_tokens,
  };
  const byName = new Map<string, Record<string, unknown>>();
  const refusals: string[] = [];
  for (const entry of raw.answers as unknown[]) {
    if (!isRecord(entry) || typeof entry.name !== 'string')
      return err('malformed_json');
    if (!Object.hasOwn(questions, entry.name) || byName.has(entry.name))
      return err('key_mismatch');
    byName.set(entry.name, entry);
    if (entry.type === 'refusal') refusals.push(entry.name);
  }
  const answers: Record<string, WireAnswer> = Object.create(null);
  for (const [name, entry] of byName) {
    if (entry.type === 'refusal') continue;
    const answer = wireAnswer(entry, questions[name] as ProviderQuestion);
    if (isOk(answer)) answers[name] = answer.value;
    else if (refusals.length === 0) return answer;
  }
  return ok({ answers, refusals, usage });
}

function wireAnswer(
  entry: Record<string, unknown>,
  question: ProviderQuestion,
): Result<WireAnswer, InvalidReplyReason> {
  const kind =
    typeof entry.type === 'string' && Object.hasOwn(WIRE_KINDS, entry.type)
      ? WIRE_KINDS[entry.type]
      : undefined;
  if (kind === undefined) return err('malformed_json');
  if (kind !== question.type) return err('wrong_type');
  if (question.type === 'noul')
    return ok({ type: 'noul', noul: entry.probability as number });
  if (question.type === 'score') {
    const probabilities = probabilityRecord(entry.probabilities, (value) =>
      Number.isSafeInteger(value) ? ok(String(value)) : err('key_mismatch'),
    );
    if (!isOk(probabilities)) return probabilities;
    return ok({
      type: 'score',
      score: entry.score as number,
      confidence: entry.confidence as number,
      probabilities: probabilities.value,
      legend: Object.fromEntries(
        question.criteria.map((level, index) => [String(index), level]),
      ),
    });
  }
  const probabilities = probabilityRecord(entry.probabilities, (value) =>
    typeof value === 'string' ? ok(value) : err('malformed_json'),
  );
  if (!isOk(probabilities)) return probabilities;
  return ok({
    type: 'choice',
    choice: entry.choice as string,
    confidence: entry.confidence as number,
    probabilities: probabilities.value,
  });
}

function probabilityRecord(
  entries: unknown,
  keyOf: (value: unknown) => Result<string, InvalidReplyReason>,
): Result<Record<string, number>, InvalidReplyReason> {
  if (!Array.isArray(entries)) return err('malformed_json');
  const record: Record<string, number> = Object.create(null);
  for (const entry of entries as unknown[]) {
    if (!isRecord(entry)) return err('malformed_json');
    const key = keyOf(entry.value);
    if (!isOk(key)) return key;
    if (Object.hasOwn(record, key.value)) return err('key_mismatch');
    record[key.value] = entry.probability as number;
  }
  return ok(record);
}
