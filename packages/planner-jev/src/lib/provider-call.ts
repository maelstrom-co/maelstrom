import { cancellationError } from '@maelstrom-co/engine';
import { err, isOk, ok } from '@maelstrom-co/protocol';
import type { WireAnswer } from '@tanstack/ai';
import type {
  WireChoiceQuestion,
  WireNoulQuestion,
  WireScoreQuestion,
} from '@tanstack/ai/adapters';

import type {
  Ask,
  AskCall,
  CallAnswer,
  CallOutcome,
  ProviderFailureCode,
} from './ask.js';
import { deferAt } from './defer.js';
import { isErrorIdentifier } from './error-identifier.js';
import { overOptionCap, type QuestionText, type Usage } from './questions.js';
import {
  type InvalidReplyReason,
  validateWireAnswers,
  withoutProbabilities,
} from './reply-validation.js';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * A choice question on the transport seam: TanStack's `WireChoiceQuestion`
 * widened so an option description may be a structured {@link QuestionText}
 * as well as a string.
 */
export interface ProviderChoiceQuestion
  extends Omit<WireChoiceQuestion, 'criteria'> {
  /** Option key to description, or `null` when the key is enough. */
  readonly criteria: Readonly<Record<string, QuestionText | null>>;
}

/**
 * A question as a transport receives it: a compatible superset of
 * TanStack's `WireQuestion`, with one widening. A choice option description
 * may be a structured {@link QuestionText} as well as a string. A transport
 * that bridges to a TanStack evaluate adapter stringifies such descriptions
 * before calling `adapter.evaluate()`.
 */
export type ProviderQuestion =
  | ProviderChoiceQuestion
  | WireScoreQuestion
  | WireNoulQuestion;

/**
 * One provider request: the shape of TanStack's `EvaluateOptions` without
 * `logger`, `modelOptions` and `abortSignal` (the signal is the second
 * argument of {@link ProviderTransport.send}). `state` is `unknown`, wider
 * than TanStack's `EvaluateState`, so a bridging transport narrows it.
 */
export interface ProviderRequest {
  /** The model id the request names. */
  readonly model: string;
  /** Shared state every question judges. */
  readonly state: unknown;
  /** The questions, keyed by question id, in the evaluation's order. */
  readonly questions: Readonly<Record<string, ProviderQuestion>>;
}

/**
 * Why a transport returned no reply. It holds no provider text, so it is
 * safe to log: `network` for a request that never got a response or a body
 * that could not be read, `http` for a non-2xx status with the provider's
 * error type and code when they parse as short identifiers,
 * `invalid_reply` with the check the reply failed. {@link createProviderCall}
 * drops an error type or code that is not a short identifier before it logs
 * the failure, but only the transport knows the key, so the transport keeps
 * it out of both.
 */
export type TransportFailure =
  | { readonly kind: 'network' }
  | {
      readonly kind: 'http';
      /** The HTTP status. */
      readonly status: number;
      /** The provider's error type, when it is a short identifier free of any secret. */
      readonly errorType?: string;
      /** The provider's error code, when it is a short identifier free of any secret. */
      readonly errorCode?: string;
    }
  | { readonly kind: 'invalid_reply'; readonly reason: InvalidReplyReason };

/**
 * A decoded provider reply: a superset of TanStack's
 * `EvaluateAdapterResult`. The answers are only claimed to be TanStack wire
 * answers and are still unvalidated: {@link createProviderCall} validates
 * every answer against the asked question.
 */
export interface TransportReply {
  /** The answers, keyed by question id, in TanStack's wire answer shapes. */
  readonly answers: Readonly<Record<string, WireAnswer>>;
  /**
   * The ids of the refused questions. A transport returns the other answers
   * it decoded, and {@link createProviderCall} ignores them when any
   * question is refused.
   */
  readonly refusals: readonly string[];
  /** Token usage, present on a refusal too. */
  readonly usage: Usage;
  /** The parsed reply body, for `logReplies`. */
  readonly raw: unknown;
}

/**
 * What one {@link ProviderTransport.send} returns. A failure carries `raw`
 * when the body parsed but did not decode.
 */
export type TransportResult =
  | { readonly ok: true; readonly reply: TransportReply }
  | {
      readonly ok: false;
      readonly failure: TransportFailure;
      readonly raw?: unknown;
    };

/**
 * Encodes a {@link ProviderRequest} for one provider, sends it and decodes
 * the reply. A transport never throws for network, HTTP or body problems
 * and returns them as a {@link TransportFailure} instead. It honours
 * `signal`, which carries both the caller's abort and the timeout. It caps
 * every body read, and it never puts a secret in a failure. Encoding errors
 * may throw, and they reject the call.
 */
export interface ProviderTransport {
  /** Sends `request` and resolves once the reply is decoded or has failed. */
  send(request: ProviderRequest, signal: AbortSignal): Promise<TransportResult>;
}

/** Settings for {@link createProviderCall}. */
export interface ProviderCallOptions {
  /** Names the provider in the cancellation message, as in `Jev call cancelled`. */
  readonly label: string;
  /** The model id sent with every request and reported with every call. */
  readonly model: string;
  /** Per-call timeout in milliseconds, combined with the request's signal. */
  readonly timeoutMs: number;
  /** Called once per call, for instrumentation. */
  readonly onCall?: (call: AskCall) => void;
  /**
   * Logs every parsed reply at debug as `jev.reply`, with the state and
   * questions it answers, all as JSON strings, before validation.
   */
  readonly logReplies: boolean;
  /** Sends each request to the provider. */
  readonly transport: ProviderTransport;
}

/**
 * An {@link Ask} that runs the provider call flow every planner provider
 * shares around one {@link ProviderTransport}. A question over the option
 * cap defers `option_cap` and an already aborted request is cancelled,
 * both before anything is sent. A transport failure defers with its
 * `provider_*` code (`provider_timeout` once the timeout has fired) and logs
 * `jev.provider_failure` at warn with the typed `failure`. A refusal defers
 * `provider_refusal` on the first refused question in question order without
 * validating the other answers, and a refusal of a question that was not
 * asked is an invalid reply (`key_mismatch`). Every other reply is validated
 * against the asked questions, and an invalid one defers
 * `provider_invalid_reply`. A user abort, which wins over the timeout,
 * returns a `CancellationError`. Every call that does not reject logs
 * `jev.call` at debug, emits a `jev.call` instrument event and reaches
 * `onCall`. A transport that throws rejects the ask with none of these.
 */
export function createProviderCall(options: ProviderCallOptions): Ask {
  const { label, model, timeoutMs, onCall, logReplies, transport } = options;
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
        model,
        questionIds,
        latencyMs,
        outcome,
        ...(usage && {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }),
      });
      ctx.instrument.event('jev.call', {
        'gen_ai.request.model': model,
        ...(usage && {
          'gen_ai.usage.input_tokens': usage.inputTokens,
          'gen_ai.usage.output_tokens': usage.outputTokens,
        }),
        'maelstrom.stage': stage,
        'maelstrom.outcome': outcome,
        'maelstrom.latency_ms': latencyMs,
        'maelstrom.question_ids': questionIds.join(','),
      });
      onCall?.({
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
        cancellationError(`${label} call cancelled`, ctx.signal?.reason),
      );
    };
    const warn = (
      code: CallOutcome,
      detail: string,
      failure?: TransportFailure,
    ) =>
      ctx.logger.warn('jev.provider_failure', {
        stage,
        reason: `${stage}/${code}`,
        detail,
        ...(failure && { failure }),
      });
    const providerFailure = (
      code: ProviderFailureCode,
      detail: string,
      failure: TransportFailure,
    ) => {
      report(code);
      warn(code, detail, failure);
      return deferAt(ctx, stage, code);
    };

    const tooLarge = overOptionCap(evaluation);
    if (tooLarge !== undefined) {
      report('option_cap');
      return deferAt(ctx, stage, 'option_cap', tooLarge);
    }
    if (ctx.signal?.aborted) return cancelled();

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, timeout])
      : timeout;
    const failed = (unchecked: TransportFailure) => {
      if (ctx.signal?.aborted) return cancelled();
      const failure = withIdentifierFields(unchecked);
      if (timeout.aborted)
        return providerFailure(
          'provider_timeout',
          `no reply within ${timeoutMs} ms`,
          failure,
        );
      return providerFailure(
        FAILURE_CODES[failure.kind],
        failureDetail(failure),
        failure,
      );
    };

    const result = await transport.send(
      { model, state: evaluation.state, questions: evaluation.questions },
      signal,
    );
    if (logReplies && (result.ok || result.raw !== undefined))
      // Console loggers cut nested objects short. JSON keeps every answer.
      ctx.logger.debug('jev.reply', {
        stage,
        state: JSON.stringify(evaluation.state),
        questions: JSON.stringify(evaluation.questions),
        reply: JSON.stringify(result.ok ? result.reply.raw : result.raw),
      });
    if (!result.ok) return failed(result.failure);

    const { reply } = result;
    if (reply.refusals.length > 0) {
      if (reply.refusals.some((id) => !questionIds.includes(id)))
        return failed({ kind: 'invalid_reply', reason: 'key_mismatch' });
      if (ctx.signal?.aborted) return cancelled();
      const refused = questionIds.find((id) =>
        reply.refusals.includes(id),
      ) as string;
      report('provider_refusal', reply.usage);
      warn('provider_refusal', `refused ${refused}`);
      return deferAt(ctx, stage, 'provider_refusal', refused);
    }

    const answers = validateWireAnswers(reply.answers, evaluation);
    if (!isOk(answers))
      return failed({ kind: 'invalid_reply', reason: answers.error });
    if (ctx.signal?.aborted) return cancelled();
    report('ok', reply.usage, answers.value);
    return ok(
      withoutProbabilities({ answers: answers.value, usage: reply.usage }),
    );
  };
}

/** The settings a fetch-based provider client takes, with the model already resolved. */
export interface ProviderClientOptions {
  /** Provider API key. Server-side only, never logged or echoed in errors. */
  readonly apiKey: string;
  /** The resolved model id. */
  readonly model: string;
  /** Endpoint URL. Defaults to the provider's own. */
  readonly endpoint?: string;
  /** Transport, for tests. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Per-call timeout in milliseconds. Defaults to 5000. */
  readonly timeoutMs?: number;
  /** Called once per call, for instrumentation. */
  readonly onCall?: (call: AskCall) => void;
  /** Logs every parsed reply at debug as `jev.reply`. Defaults to `false`. */
  readonly logReplies?: boolean;
}

/** {@link ProviderClientOptions} once checked, with every default applied. */
export interface ProviderClientConfig {
  /** Provider API key. */
  readonly apiKey: string;
  /** The model id. */
  readonly model: string;
  /** Endpoint URL. */
  readonly endpoint: string;
  /** Transport. */
  readonly fetch: typeof globalThis.fetch;
  /** Per-call timeout in milliseconds. */
  readonly timeoutMs: number;
  /** Called once per call, for instrumentation. */
  readonly onCall: ((call: AskCall) => void) | undefined;
  /** Whether every parsed reply is logged. */
  readonly logReplies: boolean;
}

/**
 * Checks the options of a fetch-based provider client, in order `apiKey`,
 * `model`, `endpoint`, `fetch`, `timeoutMs`, `onCall`, `logReplies`, and
 * applies their defaults.
 *
 * @throws {Error} `Invalid <label> option: ...` naming the first invalid
 * option. The message never contains the key.
 */
export function validateClientOptions(
  options: ProviderClientOptions,
  label: string,
  defaultEndpoint: string,
): ProviderClientConfig {
  const invalid = (message: string) =>
    new Error(`Invalid ${label} option: ${message}`);
  if (typeof options.apiKey !== 'string' || options.apiKey.length === 0)
    throw invalid('apiKey must be a non-empty string');
  if (typeof options.model !== 'string' || options.model.length === 0)
    throw invalid('model must be a non-empty string');
  const endpoint = options.endpoint ?? defaultEndpoint;
  try {
    new URL(endpoint);
  } catch {
    throw invalid('endpoint must be a URL');
  }
  if (options.fetch !== undefined && typeof options.fetch !== 'function')
    throw invalid('fetch must be a function');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw invalid('timeoutMs must be positive');
  if (options.onCall !== undefined && typeof options.onCall !== 'function')
    throw invalid('onCall must be a function');
  if (
    options.logReplies !== undefined &&
    typeof options.logReplies !== 'boolean'
  )
    throw invalid('logReplies must be a boolean');
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

const FAILURE_CODES = {
  network: 'provider_network',
  http: 'provider_http',
  invalid_reply: 'provider_invalid_reply',
} as const satisfies Record<TransportFailure['kind'], ProviderFailureCode>;

function failureDetail(failure: TransportFailure): string {
  if (failure.kind === 'network') return 'request failed';
  if (failure.kind === 'invalid_reply')
    return `invalid reply (${failure.reason})`;
  const fields = [failure.errorType, failure.errorCode].filter(
    (field) => field !== undefined,
  );
  return fields.length > 0
    ? `HTTP ${failure.status} (${fields.join(', ')})`
    : `HTTP ${failure.status}`;
}

function withIdentifierFields(failure: TransportFailure): TransportFailure {
  if (failure.kind !== 'http') return failure;
  const { errorType, errorCode, ...rest } = failure;
  return {
    ...rest,
    ...(isErrorIdentifier(errorType) && { errorType }),
    ...(isErrorIdentifier(errorCode) && { errorCode }),
  };
}
