import { describe, expect, it } from 'bun:test';

import { parseOpenAIServerEvent } from './parse-openai-event.js';

describe('parseOpenAIServerEvent — tool calls', () => {
  it('maps a function_call event to a tool_call adapter event', () => {
    const raw = {
      type: 'function_call',
      name: 'update_ui',
      arguments: '{"intent":"show labs"}',
      call_id: 'call_abc123',
    };

    expect(parseOpenAIServerEvent(raw)).toEqual({
      type: 'tool_call',
      callId: 'call_abc123',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
  });

  it('returns null when a function_call event is missing a required field', () => {
    const raw = { type: 'function_call', name: 'update_ui', call_id: 'call_1' };
    expect(parseOpenAIServerEvent(raw)).toBeNull();
  });
});

describe('parseOpenAIServerEvent — transcript', () => {
  it('maps an assistant transcript delta to a non-final transcript event', () => {
    const raw = {
      type: 'response.audio_transcript.delta',
      item_id: 'item_1',
      delta: 'Pulling that up',
    };

    expect(parseOpenAIServerEvent(raw)).toEqual({
      type: 'transcript',
      role: 'assistant',
      text: 'Pulling that up',
      final: false,
    });
  });

  it('maps an assistant transcript done to a final transcript event', () => {
    const raw = {
      type: 'response.audio_transcript.done',
      item_id: 'item_1',
      transcript: 'Pulling that up for you now.',
    };

    expect(parseOpenAIServerEvent(raw)).toEqual({
      type: 'transcript',
      role: 'assistant',
      text: 'Pulling that up for you now.',
      final: true,
    });
  });

  it('maps a completed user input transcription to a final user transcript event', () => {
    const raw = {
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'item_2',
      transcript: 'show me the labs',
    };

    expect(parseOpenAIServerEvent(raw)).toEqual({
      type: 'transcript',
      role: 'user',
      text: 'show me the labs',
      final: true,
    });
  });

  it('maps user input transcription deltas to non-final user transcripts', () => {
    expect(
      parseOpenAIServerEvent({
        type: 'conversation.item.input_audio_transcription.delta',
        delta: 'take me ',
      }),
    ).toEqual({
      type: 'transcript',
      role: 'user',
      text: 'take me ',
      final: false,
    });
  });

  it('rejects a user transcription delta without a string delta', () => {
    expect(
      parseOpenAIServerEvent({
        type: 'conversation.item.input_audio_transcription.delta',
      }),
    ).toBeNull();
  });
});

describe('parseOpenAIServerEvent — speech and error', () => {
  it('maps input_audio_buffer.speech_started to a speech_started event', () => {
    expect(
      parseOpenAIServerEvent({ type: 'input_audio_buffer.speech_started' }),
    ).toEqual({
      type: 'speech_started',
    });
  });

  it('maps an error event to an error adapter event', () => {
    const raw = {
      type: 'error',
      error: { message: 'boom', code: 'invalid_request' },
    };
    expect(parseOpenAIServerEvent(raw)).toEqual({
      type: 'error',
      error: { message: 'boom', code: 'invalid_request' },
    });
  });
});

describe('parseOpenAIServerEvent — unknown / malformed input', () => {
  it('returns null for an unrecognized event type', () => {
    expect(parseOpenAIServerEvent({ type: 'session.updated' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseOpenAIServerEvent('not an object')).toBeNull();
    expect(parseOpenAIServerEvent(null)).toBeNull();
    expect(parseOpenAIServerEvent(undefined)).toBeNull();
  });

  it('returns null when type is missing or not a string', () => {
    expect(parseOpenAIServerEvent({})).toBeNull();
    expect(parseOpenAIServerEvent({ type: 42 })).toBeNull();
  });
});
