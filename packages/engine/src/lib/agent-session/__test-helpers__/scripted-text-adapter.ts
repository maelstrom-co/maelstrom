import {
  EventType,
  type StreamChunk,
  type TextOptions,
  type TokenUsage,
} from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';

/** One scripted model call: the chunks the adapter streams for one request. */
export type ScriptedModelCall = (
  request: TextOptions,
) => AsyncGenerator<StreamChunk>;

/** A tool call a scripted turn requests. */
export interface ScriptedToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

/** A text adapter that answers the n-th request with the n-th scripted call and records every request. */
export function scriptedTextAdapter(
  calls: readonly ScriptedModelCall[],
  model = 'scripted-model',
) {
  const requests: TextOptions[] = [];
  const adapter = Object.assign(fakeText({ model }), {
    async *chatStream(request: TextOptions): AsyncGenerator<StreamChunk> {
      requests.push(request);
      const call = calls[requests.length - 1];
      if (call === undefined) throw new Error('script exhausted');
      for await (const chunk of call(request)) {
        yield {
          ...chunk,
          ...(chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR'
            ? { model }
            : {}),
        };
      }
    },
  });
  return { adapter, requests };
}

/** A turn answering with text deltas. */
export function scriptedTextTurn(
  deltas: readonly string[],
  reported: TokenUsage | undefined,
): ScriptedModelCall {
  return async function* () {
    yield runStarted();
    yield {
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'm',
      role: 'assistant',
      timestamp: 0,
    };
    for (const delta of deltas) {
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm',
        delta,
        timestamp: 0,
      };
    }
    yield { type: EventType.TEXT_MESSAGE_END, messageId: 'm', timestamp: 0 };
    yield runFinished('stop', reported);
  };
}

/** A turn requesting tool calls. */
export function scriptedToolTurn(
  calls: readonly ScriptedToolCall[],
  reported: TokenUsage | undefined,
): ScriptedModelCall {
  return async function* () {
    yield runStarted();
    for (const call of calls) {
      yield {
        type: EventType.TOOL_CALL_START,
        toolCallId: call.id,
        toolCallName: call.name,
        timestamp: 0,
      };
      yield {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: call.id,
        delta: JSON.stringify(call.args),
        timestamp: 0,
      };
      yield {
        type: EventType.TOOL_CALL_END,
        toolCallId: call.id,
        timestamp: 0,
      };
    }
    yield runFinished('tool_calls', reported);
  };
}

/** A turn that streams some text and then fails. */
export function scriptedFailingTurn(
  deltas: readonly string[],
  message: string,
): ScriptedModelCall {
  return async function* () {
    yield runStarted();
    yield {
      type: EventType.TEXT_MESSAGE_START,
      messageId: 'm',
      role: 'assistant',
      timestamp: 0,
    };
    for (const delta of deltas) {
      yield {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm',
        delta,
        timestamp: 0,
      };
    }
    yield {
      type: EventType.RUN_ERROR,
      message,
      code: 'upstream',
      timestamp: 0,
    } as StreamChunk;
  };
}

/** Provider usage with the given token counts. */
export function scriptedUsage(
  promptTokens: number,
  completionTokens: number,
): TokenUsage {
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function runStarted(): StreamChunk {
  return {
    type: EventType.RUN_STARTED,
    runId: 'provider-run',
    threadId: 'provider-thread',
    timestamp: 0,
  };
}

function runFinished(
  finishReason: 'stop' | 'tool_calls',
  reported: TokenUsage | undefined,
): StreamChunk {
  return {
    type: EventType.RUN_FINISHED,
    runId: 'provider-run',
    threadId: 'provider-thread',
    finishReason,
    ...(reported !== undefined && { usage: reported }),
    timestamp: 0,
  };
}
