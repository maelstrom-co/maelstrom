// PROTOTYPE (MAE-825): throwaway agent loop, never merge.
/**
 * Wraps a TanStack OpenAI Responses adapter's client so every
 * `responses.create` call reports its start, first output and token usage.
 * The adapter keeps working unchanged when the client shape is unexpected.
 */
import type { AnyTextAdapter } from '@tanstack/ai';

export interface ObservedCallStart {
  /** True for a `json_schema` structured-output request (router, Planner). */
  readonly structured: boolean;
  readonly reasoningEffort: string | undefined;
}

export interface ObservedUsage {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly reasoningTokens: number;
  readonly outputTokens: number;
}

export interface ObservedCall {
  /** First output item or delta of a streamed call; never fires for a non-streamed one. */
  readonly onFirstOutput: () => void;
  readonly onEnd: (end: {
    readonly ok: boolean;
    readonly usage: ObservedUsage | null;
  }) => void;
}

export type OpenaiCallListener = (
  start: ObservedCallStart,
) => ObservedCall | undefined;

/** Patches `adapter`'s own client in place and returns the same adapter. */
export function observeOpenaiCalls(
  adapter: AnyTextAdapter,
  listener: OpenaiCallListener,
): AnyTextAdapter {
  const responses = (adapter as unknown as { client?: { responses?: unknown } })
    .client?.responses as
    | { create: (...args: unknown[]) => Promise<unknown> }
    | undefined;
  if (!responses || typeof responses.create !== 'function') return adapter;
  const create = responses.create.bind(responses);
  responses.create = async (...args: unknown[]) => {
    const body = (args[0] ?? {}) as RequestBody;
    const call = listener({
      structured: body.text?.format?.type === 'json_schema',
      reasoningEffort: body.reasoning?.effort,
    });
    let result: unknown;
    try {
      result = await create(...args);
    } catch (error) {
      call?.onEnd({ ok: false, usage: null });
      throw error;
    }
    if (!call) return result;
    if (!body.stream) {
      call.onEnd({
        ok: true,
        usage: usageOf((result as { usage?: RawUsage }).usage),
      });
      return result;
    }
    return observeStream(result as AsyncIterable<StreamEvent>, call);
  };
  return adapter;
}

interface RequestBody {
  readonly stream?: boolean;
  readonly reasoning?: { readonly effort?: string };
  readonly text?: { readonly format?: { readonly type?: string } };
}

interface RawUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly input_tokens_details?: { readonly cached_tokens?: number };
  readonly output_tokens_details?: { readonly reasoning_tokens?: number };
}

interface StreamEvent {
  readonly type?: string;
  readonly item?: { readonly type?: string };
  readonly response?: { readonly usage?: RawUsage };
}

function observeStream(
  stream: AsyncIterable<StreamEvent>,
  call: ObservedCall,
): AsyncIterable<StreamEvent> {
  return new Proxy(stream as object, {
    get(target, property) {
      if (property === Symbol.asyncIterator)
        return () => relay(target as AsyncIterable<StreamEvent>, call);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as AsyncIterable<StreamEvent>;
}

async function* relay(
  stream: AsyncIterable<StreamEvent>,
  call: ObservedCall,
): AsyncGenerator<StreamEvent> {
  let sawOutput = false;
  let usage: ObservedUsage | null = null;
  let ok = false;
  try {
    for await (const event of stream) {
      if (!sawOutput && isFirstOutput(event)) {
        sawOutput = true;
        call.onFirstOutput();
      }
      if (event.type === 'response.completed')
        usage = usageOf(event.response?.usage);
      yield event;
    }
    ok = true;
  } finally {
    call.onEnd({ ok, usage });
  }
}

function isFirstOutput(event: StreamEvent): boolean {
  return (
    event.type === 'response.output_text.delta' ||
    event.type === 'response.function_call_arguments.delta' ||
    (event.type === 'response.output_item.added' &&
      event.item?.type !== 'reasoning')
  );
}

function usageOf(raw: RawUsage | undefined): ObservedUsage | null {
  if (!raw) return null;
  return {
    inputTokens: raw.input_tokens ?? 0,
    cachedTokens: raw.input_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: raw.output_tokens_details?.reasoning_tokens ?? 0,
    outputTokens: raw.output_tokens ?? 0,
  };
}
