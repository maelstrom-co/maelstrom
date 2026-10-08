import {
  type AnyTextAdapter,
  fromSpecTokenUsage,
  type StreamChunk,
  type TokenUsage,
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
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
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
 * usage to `sink`, once per call. `chat()` hands usage only to middleware,
 * which the planners do not take, so the adapter is the one place that sees
 * it: streamed calls carry it on their `RUN_FINISHED` chunk and
 * `structuredOutput` on its result. Methods run with the wrapped adapter as
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
          let usage: TokenUsage | undefined;
          try {
            const result = await value.apply(target, args);
            usage = result?.usage;
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
  let usage: TokenUsage | undefined;
  try {
    for await (const chunk of stream) {
      if (chunk.type === 'RUN_FINISHED' && chunk.usage)
        usage = Array.isArray(chunk.usage)
          ? fromSpecTokenUsage(chunk.usage)
          : chunk.usage;
      yield chunk;
    }
  } finally {
    sink(call(role, started, usage));
  }
}

function call(
  role: LlmRole,
  started: number,
  usage: TokenUsage | undefined,
): LlmCall {
  return {
    role,
    latencyMs: performance.now() - started,
    ...(usage && {
      usage: {
        inputTokens: usage.promptTokens,
        outputTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    }),
  };
}
