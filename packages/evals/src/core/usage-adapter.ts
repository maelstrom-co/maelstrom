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

export interface LlmUsage {
  /** Reported input tokens; absent when the provider omitted this counter. */
  readonly inputTokens?: number;
  /** Reported output tokens; absent when the provider omitted this counter. */
  readonly outputTokens?: number;
  /** Reported total tokens; not derived from other counters. */
  readonly totalTokens?: number;
}

export interface LlmCall {
  readonly role: LlmRole;
  readonly latencyMs: number;
  /** Absent when the provider reported none. */
  readonly usage?: LlmUsage;
}

const STREAMS = ['chatStream', 'structuredOutputStream'] as const;

/**
 * Wraps `adapter` so every provider call reports its latency and token
 * usage to `sink`, once per call. Evaluation reports use this role-labelled
 * sink, not the planner's `llm.call` events, so telemetry does not double-count
 * usage. Streamed calls carry usage on their `RUN_FINISHED` chunk and
 * `structuredOutput` on its result. Methods run with the original adapter as
 * `this`, and a method the adapter lacks stays absent, because `chat()`
 * picks its path by probing for `structuredOutputStream`.
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
      if (chunk.type === 'RUN_FINISHED') usage = reportedUsage(chunk.usage);
      yield chunk;
    }
  } finally {
    sink(call(role, started, usage));
  }
}

function reportedUsage(
  usage: TokenUsage | SpecTokenUsage[] | undefined,
): LlmUsage | undefined {
  if (!usage) return undefined;
  const entries = Array.isArray(usage)
    ? usage
    : [
        {
          inputTokens: usage.promptTokens,
          outputTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        },
      ];
  const totals: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  } = {};
  for (const entry of entries) {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens'] as const) {
      const value = entry[key];
      if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value;
    }
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
