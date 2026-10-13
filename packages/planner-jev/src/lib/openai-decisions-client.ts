import { cancellationError } from '@maelstrom-co/engine';
import { err, isOk, ok } from '@maelstrom-co/protocol';

import type {
  Ask,
  AskCall,
  CallAnswer,
  CallOutcome,
  ProviderFailureCode,
} from './ask.js';
import { deferAt } from './defer.js';
import { readBody } from './provider-fetch.js';
import {
  type Evaluation,
  overOptionCap,
  type Question,
  type QuestionText,
  type Usage,
} from './questions.js';
import {
  choiceAnswer,
  isCount,
  isProbability,
  isRecord,
  levelAnswer,
  noulAnswer,
  withoutProbabilities,
} from './reply-validation.js';

/** The default Decisions model. */
export const DECISIONS_MODEL = 'gpt-6-luna';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/decisions';
const DEFAULT_TIMEOUT_MS = 5000;

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
  const config = validateOptions(options);
  return async (stage, evaluation, ctx) => {
    const questionIds = Object.keys(evaluation.questions);
    const started = performance.now();
    const report = (
      outcome: CallOutcome,
      usage?: Usage,
      answers?: Readonly<Record<string, CallAnswer>>,
    ) => {
      const latencyMs = performance.now() - started;
      ctx.logger.debug('jev.call', {
        stage,
        model: config.model,
        questionIds,
        latencyMs,
        outcome,
        ...(usage && {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }),
      });
      ctx.instrument.event('jev.call', {
        'gen_ai.request.model': config.model,
        ...(usage && {
          'gen_ai.usage.input_tokens': usage.inputTokens,
          'gen_ai.usage.output_tokens': usage.outputTokens,
        }),
        'maelstrom.stage': stage,
        'maelstrom.outcome': outcome,
        'maelstrom.latency_ms': latencyMs,
        'maelstrom.question_ids': questionIds.join(','),
      });
      config.onCall?.({
        stage,
        questionIds,
        latencyMs,
        outcome,
        ...(usage && { usage }),
        ...(answers && { answers }),
      });
    };
    const cancelled = () => {
      report('cancelled');
      return err(
        cancellationError('Decisions call cancelled', ctx.signal?.reason),
      );
    };
    const warn = (code: CallOutcome, detail: string) =>
      ctx.logger.warn('jev.provider_failure', {
        stage,
        reason: `${stage}/${code}`,
        detail,
      });
    const providerFailure = (code: ProviderFailureCode, detail: string) => {
      report(code);
      warn(code, detail);
      return deferAt(ctx, stage, code);
    };

    const tooLarge = overOptionCap(evaluation);
    if (tooLarge !== undefined) {
      report('option_cap');
      return deferAt(ctx, stage, 'option_cap', tooLarge);
    }
    if (ctx.signal?.aborted) return cancelled();

    const timeout = AbortSignal.timeout(config.timeoutMs);
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, timeout])
      : timeout;
    const failed = (code: ProviderFailureCode, detail: string) => {
      if (ctx.signal?.aborted) return cancelled();
      if (timeout.aborted)
        return providerFailure(
          'provider_timeout',
          `no reply within ${config.timeoutMs} ms`,
        );
      return providerFailure(code, detail);
    };

    const body = JSON.stringify(
      decisionsRequest(evaluation, config.model, config.render),
    );
    let response: Response;
    try {
      response = await config.fetch(config.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal,
      });
    } catch {
      return failed('provider_network', 'request failed');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return failed('provider_http', `HTTP ${response.status}`);
    }

    let raw: unknown;
    try {
      const text = await readBody(response, signal);
      if (text === undefined)
        return failed('provider_invalid_reply', 'response too large');
      raw = JSON.parse(text);
    } catch {
      return failed('provider_invalid_reply', 'response unreadable');
    }
    if (config.logReplies)
      // Console loggers cut nested objects short; JSON keeps every answer.
      ctx.logger.debug('jev.reply', {
        stage,
        state: JSON.stringify(evaluation.state),
        questions: JSON.stringify(evaluation.questions),
        reply: JSON.stringify(raw),
      });
    const parsed = parseReply(raw, evaluation);
    if (parsed === undefined)
      return failed('provider_invalid_reply', 'reply failed validation');
    if (ctx.signal?.aborted) return cancelled();
    if ('refused' in parsed) {
      report('provider_refusal', parsed.usage);
      warn('provider_refusal', `refused ${parsed.refused}`);
      return deferAt(ctx, stage, 'provider_refusal', parsed.refused);
    }
    report('ok', parsed.usage, parsed.answers);
    return ok(withoutProbabilities(parsed));
  };
}

type ParsedReply =
  | { readonly answers: Record<string, CallAnswer>; readonly usage: Usage }
  | { readonly refused: string; readonly usage: Usage };

function decisionsRequest(
  evaluation: Evaluation,
  model: string,
  render: (value: unknown) => string,
) {
  const text = (value: unknown) =>
    typeof value === 'string' ? value : render(value);
  return {
    model,
    input: text(evaluation.state),
    questions: Object.entries(evaluation.questions).map(([name, question]) =>
      decisionsQuestion(name, question, text),
    ),
  };
}

function decisionsQuestion(
  name: string,
  question: Question,
  text: (value: QuestionText) => string,
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

function parseReply(
  raw: unknown,
  evaluation: Evaluation,
): ParsedReply | undefined {
  if (
    !isRecord(raw) ||
    !Array.isArray(raw.answers) ||
    !isRecord(raw.usage) ||
    !isCount(raw.usage.input_tokens) ||
    !isCount(raw.usage.output_tokens)
  )
    return undefined;
  const usage: Usage = {
    inputTokens: raw.usage.input_tokens,
    outputTokens: raw.usage.output_tokens,
  };
  const byName = new Map<string, Record<string, unknown>>();
  for (const answer of raw.answers as unknown[]) {
    if (
      !isRecord(answer) ||
      typeof answer.name !== 'string' ||
      !Object.hasOwn(evaluation.questions, answer.name) ||
      byName.has(answer.name)
    )
      return undefined;
    byName.set(answer.name, answer);
  }
  const ids = Object.keys(evaluation.questions);
  const refused = ids.find((id) => byName.get(id)?.type === 'refusal');
  if (refused !== undefined) return { refused, usage };
  if (byName.size !== ids.length) return undefined;

  const answers: Record<string, CallAnswer> = Object.create(null);
  for (const [id, question] of Object.entries(evaluation.questions)) {
    const parsed = parseAnswer(byName.get(id), question);
    if (parsed === undefined) return undefined;
    answers[id] = parsed;
  }
  return { answers, usage };
}

function parseAnswer(
  answer: Record<string, unknown> | undefined,
  question: Question,
): CallAnswer | undefined {
  if (answer === undefined) return undefined;
  if (question.type === 'noul') {
    if (answer.type !== 'predicate' || !isProbability(answer.probability))
      return undefined;
    return noulAnswer(answer.probability);
  }
  if (question.type === 'score') {
    if (answer.type !== 'score') return undefined;
    const probabilities = probabilityRecord(answer.probabilities, (value) =>
      Number.isSafeInteger(value) ? String(value) : undefined,
    );
    if (probabilities === undefined) return undefined;
    const level = levelAnswer(
      answer.score,
      answer.confidence,
      probabilities,
      question.criteria.length,
    );
    return isOk(level) ? level.value : undefined;
  }
  if (answer.type !== 'choice') return undefined;
  const probabilities = probabilityRecord(answer.probabilities, (value) =>
    typeof value === 'string' ? value : undefined,
  );
  if (probabilities === undefined) return undefined;
  const chosen = choiceAnswer(
    answer.choice,
    answer.confidence,
    probabilities,
    Object.keys(question.criteria),
  );
  return isOk(chosen) ? chosen.value : undefined;
}

function probabilityRecord(
  entries: unknown,
  keyOf: (value: unknown) => string | undefined,
): Record<string, unknown> | undefined {
  if (!Array.isArray(entries)) return undefined;
  const record: Record<string, unknown> = Object.create(null);
  for (const entry of entries as unknown[]) {
    if (!isRecord(entry)) return undefined;
    const key = keyOf(entry.value);
    if (key === undefined || Object.hasOwn(record, key)) return undefined;
    record[key] = entry.probability;
  }
  return record;
}

function validateOptions(options: DecisionsClientOptions) {
  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0)
    throw new Error(
      'Invalid Decisions option: apiKey must be a non-empty string',
    );
  const model = options.model ?? DECISIONS_MODEL;
  if (typeof model !== 'string' || model.length === 0)
    throw new Error(
      'Invalid Decisions option: model must be a non-empty string',
    );
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  try {
    new URL(endpoint);
  } catch {
    throw new Error('Invalid Decisions option: endpoint must be a URL');
  }
  if (options.fetch !== undefined && typeof options.fetch !== 'function')
    throw new Error('Invalid Decisions option: fetch must be a function');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid Decisions option: timeoutMs must be positive');
  if (options.onCall !== undefined && typeof options.onCall !== 'function')
    throw new Error('Invalid Decisions option: onCall must be a function');
  if (
    options.logReplies !== undefined &&
    typeof options.logReplies !== 'boolean'
  )
    throw new Error('Invalid Decisions option: logReplies must be a boolean');
  if (options.render !== undefined && typeof options.render !== 'function')
    throw new Error('Invalid Decisions option: render must be a function');
  return {
    apiKey: options.apiKey,
    model,
    endpoint,
    fetch: options.fetch ?? fetch,
    timeoutMs,
    onCall: options.onCall,
    logReplies: options.logReplies ?? false,
    render: options.render ?? ((value: unknown) => JSON.stringify(value)),
  };
}
