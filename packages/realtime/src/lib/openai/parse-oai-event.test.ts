import { describe, expect, it } from 'bun:test';

import { parseOaiServerEvent } from './parse-oai-event.js';

describe('parseOaiServerEvent — tool calls', () => {
  it('maps a function_call event to a tool_call adapter event', () => {
    const raw = {
      type: 'function_call',
      name: 'update_ui',
      arguments: '{"intent":"show labs"}',
      call_id: 'call_abc123',
    };

    expect(parseOaiServerEvent(raw)).toEqual({
      type: 'tool_call',
      callId: 'call_abc123',
      name: 'update_ui',
      argumentsJson: '{"intent":"show labs"}',
    });
  });

  it('returns null when a function_call event is missing a required field', () => {
    const raw = { type: 'function_call', name: 'update_ui', call_id: 'call_1' };
    expect(parseOaiServerEvent(raw)).toBeNull();
  });
});

describe('parseOaiServerEvent — transcript', () => {
  it('maps an assistant transcript delta to a non-final transcript event', () => {
    const raw = {
      type: 'response.audio_transcript.delta',
      item_id: 'item_1',
      delta: 'Pulling that up',
    };

    expect(parseOaiServerEvent(raw)).toEqual({
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

    expect(parseOaiServerEvent(raw)).toEqual({
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

    expect(parseOaiServerEvent(raw)).toEqual({
      type: 'transcript',
      role: 'user',
      text: 'show me the labs',
      final: true,
    });
  });
});

describe('parseOaiServerEvent — speech and error', () => {
  it('maps input_audio_buffer.speech_started to a speech_started event', () => {
    expect(parseOaiServerEvent({ type: 'input_audio_buffer.speech_started' })).toEqual({
      type: 'speech_started',
    });
  });

  it('maps an error event to an error adapter event', () => {
    const raw = { type: 'error', error: { message: 'boom', code: 'invalid_request' } };
    expect(parseOaiServerEvent(raw)).toEqual({
      type: 'error',
      error: { message: 'boom', code: 'invalid_request' },
    });
  });
});

describe('parseOaiServerEvent — unknown / malformed input', () => {
  it('returns null for an unrecognized event type', () => {
    expect(parseOaiServerEvent({ type: 'session.updated' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseOaiServerEvent('not an object')).toBeNull();
    expect(parseOaiServerEvent(null)).toBeNull();
    expect(parseOaiServerEvent(undefined)).toBeNull();
  });

  it('returns null when type is missing or not a string', () => {
    expect(parseOaiServerEvent({})).toBeNull();
    expect(parseOaiServerEvent({ type: 42 })).toBeNull();
  });
});
