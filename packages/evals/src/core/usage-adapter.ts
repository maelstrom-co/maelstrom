import type {
  AnyTextAdapter,
  SpecTokenUsage,
  StreamChunk,
  TokenUsage,
} from '@tanstack/ai';

/** Every LLM role, in report order. */
export const LLM_ROLES = [
  'planner',
  'fallback',
  'complete',
  'layout',
  'grader',
] as const;

/** What an LLM call did for the turn. */
export type LlmRole = (typeof LLM_ROLES)[number];

/** Provider counters, without inferred zeros, token totals, or price estimates. */
export interface LlmUsage {
  /** Adapter-reported input tokens; absent when the adapter omitted this counter. */
  readonly inputTokens?: number;
  /** Adapter-reported output tokens; absent when the adapter omitted this counter. */
  readonly outputTokens?: number;
  /** Adapter-reported total tokens; this wrapper does not derive them. */
  readonly totalTokens?: number;
  /** Cache-read input tokens; not added to inputTokens. */
  readonly cachedInputTokens?: number;
  /** Cache-write input tokens; not added to inputTokens. */
  readonly cacheWriteInputTokens?: number;
  /** Provider-reported monetary cost, in the provider's units; absent without a quote. */
  readonly cost?: number;
}

export interface LlmCall {
  readonly role: LlmRole;
  readonly latencyMs: number;
  /** Absent when the adapter reported none. */
  readonly usage?: LlmUsage;
}

const STREAMS = ['chatStream', 'structuredOutputStream'] as const;

/**
 * Wraps `adapter` so every provider call reports its latency and token
 * usage to `sink`, once per call. Evaluation reports use this role-labelled
 * sink, not the planner's `llm.call` events, so telemetry does not double-count
 * usage. Streamed calls carry usage on `RUN_FINISHED` or `RUN_ERROR`, and
 * `structuredOutput` on its result. Methods run with the original adapter as
 * `this`, and a method the adapter lacks stays absent, because `chat()`
 * picks its path by probing for `structuredOutputStream`. Counter presence is
 * preserved at the adapter boundary; prior adapter normalization is irreversible.
 */
export function withUsage(
  adapter: AnyTextAdapter,
  role: LlmRole,
  sink: (call: LlmCall) => void,
): AnyTextAdapter {
  return new Proxy(adapter, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if ((STREAMS as readonly PropertyKey[]).includes(property))
        return (...args: unknown[]) =>
          recordStream(value.apply(target, args), role, sink);
      if (property === 'structuredOutput')
        return async (...args: unknown[]) => {
          const started = performance.now();
          let usage: LlmUsage | undefined;
          try {
            const result = await value.apply(target, args);
            usage = reportedUsage(result?.usage);
            return result;
          } finally {
            sink(call(role, started, usage));
          }
        };
      return value.bind(target);
    },
  });
}

async function* recordStream(
  stream: AsyncIterable<StreamChunk>,
  role: LlmRole,
  sink: (call: LlmCall) => void,
): AsyncGenerator<StreamChunk> {
  const started = performance.now();
  let usage: LlmUsage | undefined;
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR')
        usage ??= reportedUsage(chunk.usage, chunk.metadata?.tanstack?.usage);
      yield chunk;
    }
  } finally {
    sink(call(role, started, usage));
  }
}

function reportedUsage(
  usage: TokenUsage | SpecTokenUsage[] | undefined,
  leftover?: Omit<
    TokenUsage,
    'promptTokens' | 'completionTokens' | 'totalTokens'
  >,
): LlmUsage | undefined {
  const details = Array.isArray(usage) ? leftover : (usage ?? leftover);
  const entries = Array.isArray(usage)
    ? usage
    : usage
      ? [
          {
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.promptTokensDetails?.cachedTokens,
            cacheWriteInputTokens: usage.promptTokensDetails?.cacheWriteTokens,
          },
        ]
      : [];
  const totals: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
    cost?: number;
  } = {};
  for (const entry of entries) {
    for (const key of [
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'cachedInputTokens',
      'cacheWriteInputTokens',
    ] as const) {
      const value = entry[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
        totals[key] = (totals[key] ?? 0) + value;
    }
  }
  // Cache writes can appear in both AG-UI counters and TanStack leftovers.
  totals.cachedInputTokens ??= details?.promptTokensDetails?.cachedTokens;
  totals.cacheWriteInputTokens ??=
    details?.promptTokensDetails?.cacheWriteTokens;
  totals.cost = details?.cost;
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    const value = totals[key];
    if (value === undefined || !Number.isFinite(value) || value < 0)
      delete totals[key];
  }
  return Object.keys(totals).length > 0 ? totals : undefined;
}

function call(
  role: LlmRole,
  started: number,
  usage: LlmUsage | undefined,
): LlmCall {
  return {
    role,
    latencyMs: performance.now() - started,
    ...(usage && { usage }),
  };
}
