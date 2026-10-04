import { ToolCallId } from '@maelstrom-co/protocol';

import type { RealtimeAdapterEvent } from '@maelstrom-co/realtime';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Maps one raw OpenAI Realtime data-channel event to the adapter's
 * provider-neutral event union, or `null` if the event carries nothing
 * `RealtimeSession` needs.
 *
 * `function_call` is mapped per the OpenAI Realtime API docs (`{name,
 * arguments, call_id}` at the top level). Current assistant transcripts use
 * `response.output_audio_transcript.*`; the prior
 * `response.audio_transcript.*` names remain accepted for older sessions.
 *
 * `conversation.item.created` is intentionally unmapped: greeting playback no
 * longer waits on provider item-acks, and the event remains a known benign
 * type in the unexpected-event tracker.
 */
export function parseOpenAIServerEvent(
  raw: unknown,
): RealtimeAdapterEvent | null {
  if (!isRecord(raw)) return null;
  const type = asString(raw.type);
  if (type === undefined) return null;

  switch (type) {
    case 'function_call':
    case 'response.function_call_arguments.done': {
      // gpt-realtime-2 streams function calls via
      // `response.function_call_arguments.delta` then `.done` (with `call_id`,
      // `name`, `arguments` at the top level). Older API versions emit a
      // top-level `function_call` event with the same field names. Handle both.
      const callId = asString(raw.call_id);
      const name = asString(raw.name);
      const argumentsJson = asString(raw.arguments);
      // Explicit length check, not just the throwing ToolCallId constructor:
      // parseOpenAIServerEvent's contract is graceful null on malformed events,
      // so an empty call_id must be rejected here rather than reaching the
      // constructor and throwing.
      if (
        callId === undefined ||
        callId.length === 0 ||
        name === undefined ||
        argumentsJson === undefined
      ) {
        return null;
      }
      return {
        type: 'tool_call',
        callId: ToolCallId(callId),
        name,
        argumentsJson,
      };
    }

    case 'response.audio_transcript.delta':
    case 'response.output_audio_transcript.delta': {
      const delta = asString(raw.delta);
      if (delta === undefined) return null;
      return {
        type: 'transcript',
        role: 'assistant',
        text: delta,
        final: false,
      };
    }

    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done': {
      const transcript = asString(raw.transcript);
      if (transcript === undefined) return null;
      return {
        type: 'transcript',
        role: 'assistant',
        text: transcript,
        final: true,
      };
    }

    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = asString(raw.transcript);
      if (transcript === undefined) return null;
      return {
        type: 'transcript',
        role: 'user',
        text: transcript,
        final: true,
      };
    }

    case 'conversation.item.input_audio_transcription.delta': {
      const delta = asString(raw.delta);
      if (delta === undefined) return null;
      return { type: 'transcript', role: 'user', text: delta, final: false };
    }

    case 'input_audio_buffer.speech_started':
      return { type: 'speech_started' };

    case 'error':
      return { type: 'error', error: raw.error ?? raw };

    default:
      return null;
  }
}

/** A transcript event together with the conversation item it belongs to. */
export interface OpenAITranscriptItem {
  /** Provider conversation item id, stable across that item's deltas and its final event. */
  readonly itemId: string;
  /** Who spoke the transcribed audio. */
  readonly role: 'user' | 'assistant';
  /** A delta, or the item's full transcript when `final`. */
  readonly text: string;
  /** Whether this is the item's completing event carrying its full text. */
  readonly final: boolean;
}

/**
 * Maps a raw transcript event like {@link parseOpenAIServerEvent} does, but
 * keeps the `item_id` that the legacy transcript event drops. Returns `null`
 * for non-transcript events and for transcripts without a usable item id.
 */
export function parseOpenAITranscriptItem(
  raw: unknown,
): OpenAITranscriptItem | null {
  const event = parseOpenAIServerEvent(raw);
  if (event?.type !== 'transcript' || !isRecord(raw)) return null;
  const itemId = asString(raw.item_id);
  if (itemId === undefined || itemId.length === 0 || itemId.length > 256)
    return null;
  return { itemId, role: event.role, text: event.text, final: event.final };
}
