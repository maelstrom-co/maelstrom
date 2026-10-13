import { err, isOk, ok, type Result } from '@maelstrom-co/protocol';
import type { WireAnswer } from '@tanstack/ai';

import type { Ask, AskCall } from './ask.js';
import {
  createProviderCall,
  type ProviderTransport,
  validateClientOptions,
} from './provider-call.js';
import { type ErrorFieldsExtractor, postJson } from './provider-fetch.js';
import type { Evaluation, Reply, Usage } from './questions.js';
import {
  type InvalidReplyReason,
  isCount,
  isRecord,
  validateWireAnswers,
  withoutProbabilities,
} from './reply-validation.js';

export type { Ask, CallAnswer, CallOutcome } from './ask.js';

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

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
  const config = validateClientOptions(options, 'TypeSafe', DEFAULT_ENDPOINT);
  return createProviderCall({
    label: 'Jev',
    model: config.model,
    timeoutMs: config.timeoutMs,
    ...(config.onCall && { onCall: config.onCall }),
    logReplies: config.logReplies,
    transport: typesafeTransport(config),
  });
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
  const decoded = decodeReply(raw, model);
  if (!isOk(decoded)) return undefined;
  const answers = validateWireAnswers(decoded.value.answers, evaluation);
  if (!isOk(answers)) return undefined;
  return withoutProbabilities({
    answers: answers.value,
    usage: decoded.value.usage,
  });
}

/**
 * The transport for TypeSafe's System One endpoint. It sends the model,
 * state and questions as one JSON object in that key order, and decodes
 * the reply into TanStack wire answers, which TypeSafe's wire answers
 * already are. A reply that is not an object, whose answers are not an
 * object or whose usage counts are not integral is `malformed_json`, and a
 * reply that echoes a model other than `model` is `model_echo`. An HTTP
 * failure reads its error type and code from TypeSafe's error body,
 * `detail.error_type` and `detail.error_code`. TypeSafe never refuses, so
 * `refusals` is always empty.
 */
export function typesafeTransport({
  apiKey,
  model,
  endpoint,
  fetch,
}: {
  /** TypeSafe API key. Server-side only. */
  readonly apiKey: string;
  /** Pinned Jev model id the reply must echo. */
  readonly model: string;
  /** Endpoint URL. */
  readonly endpoint: string;
  /** The fetch to send with. */
  readonly fetch: typeof globalThis.fetch;
}): ProviderTransport {
  return {
    async send(request, signal) {
      const body = JSON.stringify({
        model: request.model,
        state: request.state,
        questions: request.questions,
      });
      const posted = await postJson({
        fetch,
        endpoint,
        apiKey,
        body,
        signal,
        errorFields: typesafeErrorFields,
      });
      if (!posted.ok) return posted;
      const decoded = decodeReply(posted.raw, model);
      if (!isOk(decoded))
        return {
          ok: false,
          failure: { kind: 'invalid_reply', reason: decoded.error },
          raw: posted.raw,
        };
      return {
        ok: true,
        reply: { ...decoded.value, refusals: [], raw: posted.raw },
      };
    },
  };
}

const typesafeErrorFields: ErrorFieldsExtractor = (body) =>
  isRecord(body) && isRecord(body.detail)
    ? { type: body.detail.error_type, code: body.detail.error_code }
    : {};

function decodeReply(
  raw: unknown,
  model: string,
): Result<
  {
    readonly answers: Readonly<Record<string, WireAnswer>>;
    readonly usage: Usage;
  },
  InvalidReplyReason
> {
  if (
    !isRecord(raw) ||
    !isRecord(raw.answers) ||
    !isRecord(raw.usage) ||
    !isCount(raw.usage.input_tokens) ||
    !isCount(raw.usage.output_tokens)
  )
    return err('malformed_json');
  if (raw.model !== model) return err('model_echo');
  return ok({
    answers: raw.answers as Record<string, WireAnswer>,
    usage: {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
    },
  });
}
