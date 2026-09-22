import type {
  CancellationError,
  Deferred,
  StageContext,
} from '@maelstrom-co/engine';
import { cancellationError } from '@maelstrom-co/engine';
import { err, ok, type Result } from '@maelstrom-co/protocol';

import { deferAt, type StageName } from './defer.js';
import {
  type Answer,
  type Evaluation,
  overOptionCap,
  type Reply,
  type Usage,
} from './questions.js';

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 256 * 1024;

/** How one TypeSafe call ended: `ok`, `cancelled`, or the deferral code. */
export type CallOutcome =
  | 'ok'
  | 'cancelled'
  | 'option_cap'
  | 'provider_timeout'
  | 'provider_network'
  | 'provider_http'
  | 'provider_invalid_reply';

/** One validated answer as {@link JevCall} reports it. */
export interface CallAnswer extends Answer {
  /** Probability per option. */
  readonly probabilities?: Readonly<Record<string, number>>;
}

/** What the client reports about each call to {@link TypeSafeClientOptions.onCall}. */
export interface JevCall {
  readonly stage: StageName;
  readonly questionIds: readonly string[];
  readonly latencyMs: number;
  readonly usage?: Usage;
  readonly outcome: CallOutcome;
  /** Every answer of a reply that passed validation, whether or not the stage later defers. */
  readonly answers?: Readonly<Record<string, CallAnswer>>;
}

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

/** Asks Jev one evaluation on behalf of `stage`. */
export type Ask = (
  stage: StageName,
  evaluation: Evaluation,
  ctx: StageContext,
) => Promise<Result<Reply, Deferred | CancellationError>>;

type ProviderCode = Exclude<CallOutcome, 'ok' | 'cancelled' | 'option_cap'>;

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
 * chosen option has the highest probability, and usage is integral.
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
    if (
      !isRecord(answer) ||
      answer.type !== 'choice' ||
      typeof answer.choice !== 'string' ||
      !isProbability(answer.confidence) ||
      !isRecord(answer.probabilities)
    )
      return undefined;
    const options = Object.keys(question.criteria);
    if (
      !sameKeys(answer.probabilities, options) ||
      !Object.hasOwn(question.criteria, answer.choice)
    )
      return undefined;
    let total = 0;
    let maximum = -1;
    const probabilities: Record<string, number> = Object.create(null);
    for (const option of options) {
      const value = answer.probabilities[option];
      if (!isProbability(value)) return undefined;
      probabilities[option] = value;
      total += value;
      maximum = Math.max(maximum, value);
    }
    if (
      Math.abs(total - 1) > 0.02 ||
      answer.probabilities[answer.choice] !== maximum
    )
      return undefined;
    answers[id] = {
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities,
    };
  }
  return {
    answers,
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    },
  };
}

function withoutProbabilities(reply: Reply): Reply {
  const answers: Record<string, Answer> = Object.create(null);
  for (const [id, { choice, confidence }] of Object.entries(reply.answers))
    answers[id] = { choice, confidence };
  return { answers, usage: reply.usage };
}

async function readBody(
  response: Response,
  signal: AbortSignal,
): Promise<string | undefined> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > MAX_RESPONSE_BYTES) return undefined;
  if (!response.body) throw new Error('response body missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      if (signal.aborted) throw new Error('request aborted');
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return undefined;
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key))
  );
}

function isProbability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
