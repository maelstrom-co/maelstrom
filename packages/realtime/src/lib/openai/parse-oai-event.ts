import type { RealtimeAdapterEvent } from '../provider-adapter.types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Maps one raw OpenAI Realtime data-channel event to the adapter's
 * provider-neutral event union, or `null` if the event carries nothing
 * `RealtimeSession` needs.
 *
 * `function_call` is mapped per the OpenAI Realtime API docs (`{name,
 * arguments, call_id}` at the top level). The transcript / speech-started /
 * error mappings below are not documented there — OpenAI's Realtime API
 * doesn't document a settled shape for those event names for
 * `gpt-realtime-1.5` at spike time, so these are the maintainer's best-known
 * shapes from prior Realtime API versions, isolated here so they're cheap to
 * correct once real traffic is observed.
 */
export function parseOaiServerEvent(raw: unknown): RealtimeAdapterEvent | null {
  if (!isRecord(raw)) return null;
  const type = asString(raw.type);
  if (type === undefined) return null;

  switch (type) {
    case 'function_call': {
      const callId = asString(raw.call_id);
      const name = asString(raw.name);
      const argumentsJson = asString(raw.arguments);
      if (callId === undefined || name === undefined || argumentsJson === undefined) {
        return null;
      }
      return { type: 'tool_call', callId, name, argumentsJson };
    }

    case 'response.audio_transcript.delta': {
      const delta = asString(raw.delta);
      if (delta === undefined) return null;
      return { type: 'transcript', role: 'assistant', text: delta, final: false };
    }

    case 'response.audio_transcript.done': {
      const transcript = asString(raw.transcript);
      if (transcript === undefined) return null;
      return { type: 'transcript', role: 'assistant', text: transcript, final: true };
    }

    case 'conversation.item.input_audio_transcription.completed': {
      const transcript = asString(raw.transcript);
      if (transcript === undefined) return null;
      return { type: 'transcript', role: 'user', text: transcript, final: true };
    }

    case 'input_audio_buffer.speech_started':
      return { type: 'speech_started' };

    case 'error':
      return { type: 'error', error: raw.error ?? raw };

    default:
      return null;
  }
}
