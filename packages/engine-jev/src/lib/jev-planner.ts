import type {
  Planner,
  PlannerFailure,
  PlanningOperationContext,
} from '@maelstrom-co/engine';
import { err, isErr, ok, type Result } from '@maelstrom-co/protocol';
import {
  type Evaluation,
  MAX_CHOICES,
  PlanningDeferral,
  planPhases,
  type Reply,
} from './phases.js';

const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MAX_RESPONSE_BYTES = 256 * 1024;

/** The server-side fetch contract accepted for test transport injection. */
export type JevFetch = typeof fetch;
/** Optional confidence gate for consumed judgments; no threshold is calibrated by this package. */
export interface JevConfidencePolicy {
  /** Defer when a consumed answer's confidence falls below this inclusive minimum in [0, 1]. */
  readonly minimum?: number;
}
/** Configuration for the experimental server-only Jev planner. */
export interface JevPlannerOptions {
  /** TypeSafe credential retained only by this server-side planner. */
  readonly apiKey: string;
  /** Pinned TypeSafe model identifier expected in successful responses. */
  readonly model: string;
  /** Trusted server URL receiving the credential; defaults to the official v1 System One endpoint. */
  readonly endpoint?: string;
  /** Injectable transport for deterministic tests. Defaults to global fetch. */
  readonly fetch?: JevFetch;
  /** Optional, explicitly uncalibrated gate applied to consumed choices. */
  readonly confidence?: JevConfidencePolicy;
}

/**
 * Creates a tiling planner with dependent view, layout, action, and parameter phases.
 *
 * Each provider request claims one shared logical call. Selection takes one call;
 * layout takes at most one; up to four ordered actions plus their final done choice
 * take at most five; each selected action's parameters take at most one. Budget up to eleven
 * calls for a complete operation. Deterministic resize uses no calls or actions.
 * The engine owns strict finalization and fallback; configure zero repair attempts.
 *
 * @param options Server-owned credential, pinned model, and transport/confidence policy.
 * @returns A tiling-only planner producing layout and actions without presentation prose.
 * @throws If an option is malformed. Credentials are never echoed in the error.
 */
export function createJevPlanner(options: JevPlannerOptions): Planner {
  const config = validateOptions(options);
  return {
    id: 'typesafe-jev',
    supportedLayoutModes: Object.freeze(['tiling']),
    async invoke(invocation) {
      const { input, context } = invocation;
      const preflight = controlFailure(context);
      if (preflight) return err(preflight);
      if (invocation.phase.kind !== 'initial')
        return ok({
          kind: 'deferred',
          reason: 'policy',
          detail: { repair: false },
        });
      if (
        input.request.context.layoutMode !== 'tiling' ||
        input.request.layout.type !== 'tiling'
      )
        return ok({ kind: 'deferred', reason: 'unsupported_capability' });
      const reasons = input.request.context.updateReasons;
      if (
        reasons.length > 0 &&
        reasons.every((reason) => reason.type === 'chart_resize')
      )
        return ok({
          kind: 'candidate',
          candidate: { layout: input.request.layout, executionPlan: [] },
        });
      try {
        const candidate = await planPhases(
          input,
          async (stage, evaluation) => {
            const reply = await ask(config, context, stage, evaluation);
            if (isErr(reply)) throw new DecisionFailure(reply.error);
            return reply.value;
          },
          config.confidence,
        );
        const terminal = controlFailure(context);
        return terminal ? err(terminal) : ok({ kind: 'candidate', candidate });
      } catch (error) {
        if (error instanceof PlanningDeferral)
          return ok({
            kind: 'deferred',
            reason: error.reason,
            detail: error.detail,
          });
        if (error instanceof DecisionFailure) return err(error.failure);
        return err({
          kind: 'validation_error',
          message: 'Jev could not compile the planning input',
        });
      }
    },
  };
}
class DecisionFailure extends Error {
  constructor(readonly failure: PlannerFailure) {
    super(failure.kind);
  }
}
type Config = ReturnType<typeof validateOptions>;
async function ask(
  config: Config,
  context: PlanningOperationContext,
  stage: string,
  evaluation: Evaluation,
): Promise<Result<Reply, PlannerFailure>> {
  const before = controlFailure(context);
  if (before) return err(before);
  if (
    Object.values(evaluation.questions).some(
      (question) => Object.keys(question.criteria).length > MAX_CHOICES,
    )
  )
    throw new PlanningDeferral('policy', { limit: 'choice_options' });
  const body = JSON.stringify({
    model: config.model,
    state: evaluation.state,
    questions: evaluation.questions,
  });
  const ready = controlFailure(context);
  if (ready) return err(ready);
  const claimed = context.calls.claim({ plannerId: 'typesafe-jev', stage });
  if (isErr(claimed))
    return err({
      kind: 'budget_exhausted',
      message: 'planning call budget exhausted',
    });
  const afterClaim = controlFailure(context);
  if (afterClaim) return err(afterClaim);
  let response: Response;
  try {
    response = await config.fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: context.signal,
    });
  } catch {
    return err(
      controlFailure(context) ?? {
        kind: 'provider_error',
        message: 'Jev request failed',
      },
    );
  }
  const after = controlFailure(context);
  if (after) return err(after);
  if (!response.ok)
    return err({
      kind: 'provider_error',
      message: `Jev returned HTTP ${response.status}`,
    });
  let raw: unknown;
  try {
    raw = JSON.parse(await readBody(response, context));
  } catch {
    return err(
      controlFailure(context) ?? {
        kind: 'invalid_provider_response',
        message: 'Jev returned an unreadable response',
      },
    );
  }
  const terminal = controlFailure(context);
  return terminal
    ? err(terminal)
    : validateReply(raw, evaluation, config.model);
}
async function readBody(
  response: Response,
  context: PlanningOperationContext,
): Promise<string> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > MAX_RESPONSE_BYTES)
    throw new Error('response too large');
  if (!response.body) throw new Error('response body missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      if (controlFailure(context)) throw new Error('request aborted');
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('response too large');
      text += decoder.decode(next.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}
function invalid(message: string): Result<never, PlannerFailure> {
  return err({ kind: 'invalid_provider_response', message });
}
function validateReply(
  raw: unknown,
  evaluation: Evaluation,
  model: string,
): Result<Reply, PlannerFailure> {
  if (
    !isRecord(raw) ||
    raw.model !== model ||
    !isRecord(raw.answers) ||
    !isRecord(raw.usage) ||
    !integer(raw.usage.input_tokens) ||
    !integer(raw.usage.output_tokens)
  )
    return invalid('Jev response metadata is invalid');
  if (!sameKeys(raw.answers, Object.keys(evaluation.questions)))
    return invalid('Jev response question IDs are invalid');
  const answers: Record<string, { choice: string; confidence: number }> =
    Object.create(null);
  for (const [id, question] of Object.entries(evaluation.questions)) {
    const answer = raw.answers[id];
    if (
      !isRecord(answer) ||
      answer.type !== 'choice' ||
      typeof answer.choice !== 'string' ||
      !probability(answer.confidence) ||
      !isRecord(answer.probabilities)
    )
      return invalid('Jev response answer is invalid');
    const options = Object.keys(question.criteria);
    if (
      !sameKeys(answer.probabilities, options) ||
      !Object.hasOwn(question.criteria, answer.choice)
    )
      return invalid('Jev response choice is invalid');
    let total = 0;
    let maximum = -1;
    for (const option of options) {
      const value = answer.probabilities[option];
      if (!probability(value))
        return invalid('Jev response probabilities are invalid');
      total += value;
      maximum = Math.max(maximum, value);
    }
    if (
      Math.abs(total - 1) > 0.02 ||
      answer.probabilities[answer.choice] !== maximum
    )
      return invalid('Jev response distribution is invalid');
    answers[id] = { choice: answer.choice, confidence: answer.confidence };
  }
  return ok({ answers });
}
function controlFailure(
  context: PlanningOperationContext,
): PlannerFailure | undefined {
  if (context.signal.aborted)
    return { kind: 'cancelled', message: 'planning operation cancelled' };
  if (context.deadlineAt !== undefined && Date.now() >= context.deadlineAt)
    return { kind: 'timeout', message: 'planning operation timed out' };
  return undefined;
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
function probability(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function validateOptions(options: JevPlannerOptions) {
  if (typeof options.apiKey !== 'string' || !options.apiKey.length)
    throw new Error(
      'Invalid Jev planner option: apiKey must be a non-empty string',
    );
  if (typeof options.model !== 'string' || !options.model.length)
    throw new Error(
      'Invalid Jev planner option: model must be a non-empty string',
    );
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  try {
    new URL(endpoint);
  } catch {
    throw new Error('Invalid Jev planner option: endpoint must be a URL');
  }
  if (options.fetch !== undefined && typeof options.fetch !== 'function')
    throw new Error('Invalid Jev planner option: fetch must be a function');
  const minimum = options.confidence?.minimum;
  if (minimum !== undefined && !probability(minimum))
    throw new Error(
      'Invalid Jev planner option: confidence.minimum must be between zero and one',
    );
  return Object.freeze({
    apiKey: options.apiKey,
    model: options.model,
    endpoint,
    fetch: options.fetch ?? fetch,
    confidence: minimum,
  });
}
