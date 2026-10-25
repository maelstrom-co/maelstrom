import {
  normalizeLlmUsage,
  type ReportedLlmUsage,
} from '@maelstrom-co/telemetry/usage';
import type { AnyTextAdapter, StreamChunk } from '@tanstack/ai';

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
export type LlmUsage = ReportedLlmUsage;

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
            usage = normalizeLlmUsage(result?.usage);
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
        usage ??= normalizeLlmUsage(
          chunk.usage,
          chunk.metadata?.tanstack?.usage,
        );
      yield chunk;
    }
  } finally {
    sink(call(role, started, usage));
  }
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
