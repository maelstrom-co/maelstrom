import { cancellationError } from '@maelstrom-co/engine';
import { err, ok } from '@maelstrom-co/protocol';

import type { Ask, AskCall, CallAnswer, CallOutcome } from './ask.js';
import { deferAt } from './defer.js';
import {
  type Evaluation,
  overOptionCap,
  type Reply,
  type ScoreQuestion,
  type Usage,
} from './questions.js';
import {
  choiceAnswer,
  isCount,
  isProbability,
  isRecord,
  levelAnswer,
  noulAnswer,
  readBody,
  sameKeys,
  withoutProbabilities,
} from './reply-validation.js';

export type { Ask, CallAnswer, CallOutcome } from './ask.js';

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_TIMEOUT_MS = 5000;

/** What the TypeSafe client reports about each call; the provider-neutral {@link AskCall}. */
export type JevCall = AskCall;

/** Connection settings for TypeSafe's System One endpoint. */
export interface TypeSafeClientOptions {
  /** TypeSafe API key. Server-side only; never logged or echoed in errors. */
  readonly apiKey: string;
  /** Pinned Jev model id, for example `jev-1.13.0`. Replies must echo it. */
  readonly model: string;
  /** Endpoint URL. Defaults to TypeSafe's v1 System One endpoint. */
  readonly endpoint?: string;
  /** Transport, for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Per-call timeout in milliseconds, combined with the request's signal. Defaults to 5000. */
  readonly timeoutMs?: number;
  /** Called once per call, for instrumentation. */
  readonly onCall?: (call: JevCall) => void;
  /**
   * Logs every parsed reply at debug as `jev.reply`, with the state and
   * questions it answers, all as JSON strings, before validation. Questions and replies can echo user text, so
   * keep it off outside local debugging. Defaults to `false`.
   */
  readonly logReplies?: boolean;
}

type ProviderCode = Exclude<CallOutcome, 'ok' | 'cancelled' | 'option_cap'>;

/**
 * An {@link Ask} that sends each evaluation to TypeSafe's System One
 * endpoint and validates the reply strictly (see {@link validateReply}).
 * A question over the option cap defers `option_cap` before any call; a
 * timeout, network failure, non-2xx status or invalid reply defers with the
 * matching `provider_*` code and logs `jev.provider_failure` at warn; a user
 * abort returns a `CancellationError`. Every call logs `jev.call` at debug,
 * emits a `jev.call` instrument event and reaches `onCall`.
 *
 * @throws {Error} If an option is invalid. The message never contains the key.
 */
export function createTypeSafeClient(options: TypeSafeClientOptions): Ask {
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
      return err(cancellationError('Jev call cancelled', ctx.signal?.reason));
    };
    const providerFailure = (code: ProviderCode, detail: string) => {
      report(code);
      ctx.logger.warn('jev.provider_failure', {
        stage,
        reason: `${stage}/${code}`,
        detail,
      });
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
    const failed = (code: ProviderCode, detail: string) => {
      if (ctx.signal?.aborted) return cancelled();
      if (timeout.aborted)
        return providerFailure(
          'provider_timeout',
          `no reply within ${config.timeoutMs} ms`,
        );
      return providerFailure(code, detail);
    };

    let response: Response;
    try {
      response = await config.fetch(config.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          state: evaluation.state,
          questions: evaluation.questions,
        }),
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
      const body = await readBody(response, signal);
      if (body === undefined)
        return failed('provider_invalid_reply', 'response too large');
      raw = JSON.parse(body);
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
    const parsed = parseReply(raw, evaluation, config.model);
    if (parsed === undefined)
      return failed('provider_invalid_reply', 'reply failed validation');
    if (ctx.signal?.aborted) return cancelled();
    report('ok', parsed.usage, parsed.answers);
    return ok(withoutProbabilities(parsed));
  };
}

/**
 * Strict reply check: the model is echoed, the answers cover exactly the
 * asked question ids, each choice is one of its question's options, the
 * probabilities cover exactly those options and sum to 1 within 0.02, the
 * chosen option has the highest probability, each noul answer is a
 * probability, each score answer echoes its question's levels in order in
 * its legend with probabilities over exactly those levels summing to 1
 * within 0.02 and a score between 0 and the top level, and usage is
 * integral. A noul answer is read as a `yes` or `no` choice and a score
 * answer keeps its score and per-level probabilities (see `Answer`).
 */
export function validateReply(
  raw: unknown,
  evaluation: Evaluation,
  model: string,
): Reply | undefined {
  const parsed = parseReply(raw, evaluation, model);
  return parsed && withoutProbabilities(parsed);
}

function parseReply(
  raw: unknown,
  evaluation: Evaluation,
  model: string,
):
  | { readonly answers: Record<string, CallAnswer>; readonly usage: Usage }
  | undefined {
  if (
    !isRecord(raw) ||
    raw.model !== model ||
    !isRecord(raw.answers) ||
    !isRecord(raw.usage) ||
    !isCount(raw.usage.input_tokens) ||
    !isCount(raw.usage.output_tokens)
  )
    return undefined;
  if (!sameKeys(raw.answers, Object.keys(evaluation.questions)))
    return undefined;
  const answers: Record<string, CallAnswer> = Object.create(null);
  for (const [id, question] of Object.entries(evaluation.questions)) {
    const answer = raw.answers[id];
    if (question.type === 'noul') {
      if (
        !isRecord(answer) ||
        answer.type !== 'noul' ||
        !isProbability(answer.noul)
      )
        return undefined;
      answers[id] = noulAnswer(answer.noul);
      continue;
    }
    if (question.type === 'score') {
      const parsed = scoreAnswer(answer, question);
      if (parsed === undefined) return undefined;
      answers[id] = parsed;
      continue;
    }
    if (!isRecord(answer) || answer.type !== 'choice') return undefined;
    const parsed = choiceAnswer(
      answer.choice,
      answer.confidence,
      answer.probabilities,
      Object.keys(question.criteria),
    );
    if (parsed === undefined) return undefined;
    answers[id] = parsed;
  }
  return {
    answers,
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    },
  };
}

function scoreAnswer(
  answer: unknown,
  question: ScoreQuestion,
): CallAnswer | undefined {
  const levelKeys = question.criteria.map((_, level) => String(level));
  if (
    !isRecord(answer) ||
    answer.type !== 'score' ||
    !isRecord(answer.legend) ||
    !sameKeys(answer.legend, levelKeys)
  )
    return undefined;
  const legend = answer.legend;
  if (levelKeys.some((key, level) => legend[key] !== question.criteria[level]))
    return undefined;
  return levelAnswer(
    answer.score,
    answer.confidence,
    answer.probabilities,
    question.criteria.length,
  );
}

function validateOptions(options: TypeSafeClientOptions) {
  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0)
    throw new Error(
      'Invalid TypeSafe option: apiKey must be a non-empty string',
    );
  if (typeof options.model !== 'string' || options.model.length === 0)
    throw new Error(
      'Invalid TypeSafe option: model must be a non-empty string',
    );
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  try {
    new URL(endpoint);
  } catch {
    throw new Error('Invalid TypeSafe option: endpoint must be a URL');
  }
  if (options.fetch !== undefined && typeof options.fetch !== 'function')
    throw new Error('Invalid TypeSafe option: fetch must be a function');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid TypeSafe option: timeoutMs must be positive');
  if (options.onCall !== undefined && typeof options.onCall !== 'function')
    throw new Error('Invalid TypeSafe option: onCall must be a function');
  if (
    options.logReplies !== undefined &&
    typeof options.logReplies !== 'boolean'
  )
    throw new Error('Invalid TypeSafe option: logReplies must be a boolean');
  return {
    apiKey: options.apiKey,
    model: options.model,
    endpoint,
    fetch: options.fetch ?? fetch,
    timeoutMs,
    onCall: options.onCall,
    logReplies: options.logReplies ?? false,
  };
}
