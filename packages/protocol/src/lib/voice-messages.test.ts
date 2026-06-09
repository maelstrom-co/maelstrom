import { describe, expect, test } from 'bun:test';

import {
  VoiceClientMessageSchema,
  VoiceServerMessageSchema,
} from './voice-messages.js';

const TS = 1_700_000_000_000;

const validReady = () => ({
  type: 'engine.stt.ready',
  sessionId: 'session-1',
  timestamp: TS,
});

const validMaelstromResponse = () => ({
  type: 'engine.maelstrom.response',
  sessionId: 'session-1',
  requestId: 'req-1',
  response: { type: 'maelstrom_response', requestId: 'req-1' },
});

const validSpeak = () => ({
  type: 'client.voice.speak',
  sessionId: 'session-1',
  timestamp: TS,
  id: 'msg-1',
  text: 'hello',
});

describe('VoiceServerMessageSchema', () => {
  test('parses a valid engine.stt.ready frame', () => {
    expect(VoiceServerMessageSchema.safeParse(validReady()).success).toBe(true);
  });

  test('parses a valid engine.maelstrom.response frame', () => {
    const result = VoiceServerMessageSchema.safeParse(validMaelstromResponse());
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'engine.maelstrom.response') {
      // Brand applied at the boundary: the value is preserved verbatim.
      expect(result.data.sessionId as string).toBe('session-1');
      expect(result.data.requestId as string).toBe('req-1');
    }
  });

  test('parses a valid engine.stt.transcript frame', () => {
    expect(
      VoiceServerMessageSchema.safeParse({
        type: 'engine.stt.transcript',
        sessionId: 'session-1',
        timestamp: TS,
        text: 'hi',
        isFinal: true,
      }).success,
    ).toBe(true);
  });

  test('rejects an empty-string sessionId', () => {
    const result = VoiceServerMessageSchema.safeParse({
      ...validReady(),
      sessionId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path[0]).toBe('sessionId');
    }
  });

  test('rejects a whitespace-only sessionId', () => {
    expect(
      VoiceServerMessageSchema.safeParse({ ...validReady(), sessionId: '   ' })
        .success,
    ).toBe(false);
  });

  test('rejects a non-string sessionId', () => {
    expect(
      VoiceServerMessageSchema.safeParse({ ...validReady(), sessionId: 42 })
        .success,
    ).toBe(false);
  });

  test('rejects a non-finite timestamp', () => {
    expect(
      VoiceServerMessageSchema.safeParse({ ...validReady(), timestamp: NaN })
        .success,
    ).toBe(false);
  });

  test('rejects engine.maelstrom.response with a missing requestId', () => {
    const { requestId: _omit, ...rest } = validMaelstromResponse();
    expect(VoiceServerMessageSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects engine.maelstrom.response with a non-object response', () => {
    expect(
      VoiceServerMessageSchema.safeParse({
        ...validMaelstromResponse(),
        response: 'not-an-object',
      }).success,
    ).toBe(false);
  });

  test('rejects an unknown discriminator', () => {
    expect(
      VoiceServerMessageSchema.safeParse({ ...validReady(), type: 'engine.bogus' })
        .success,
    ).toBe(false);
  });

  test('parses an engine.tts.sent metadata frame (opaque data)', () => {
    // engine.tts.sent is a JSON metadata frame; the audio bytes arrive
    // separately as binary, so `data` is opaque.
    expect(
      VoiceServerMessageSchema.safeParse({
        type: 'engine.tts.sent',
        sessionId: 'session-1',
        timestamp: TS,
        data: new Uint8Array(0),
        format: 'pcm',
        sampleRate: 24000,
        sequence: 0,
        isFinal: false,
      }).success,
    ).toBe(true);
  });

  test('rejects engine.tts.sent with an empty-string sessionId', () => {
    expect(
      VoiceServerMessageSchema.safeParse({
        type: 'engine.tts.sent',
        sessionId: '',
        timestamp: TS,
        data: new Uint8Array(0),
        format: 'pcm',
        sampleRate: 24000,
        sequence: 0,
        isFinal: false,
      }).success,
    ).toBe(false);
  });
});

describe('VoiceClientMessageSchema', () => {
  test('parses a valid client.audio_capture.ready frame', () => {
    expect(
      VoiceClientMessageSchema.safeParse({
        type: 'client.audio_capture.ready',
        sessionId: 'session-1',
        timestamp: TS,
      }).success,
    ).toBe(true);
  });

  test('parses a valid client.voice.speak frame', () => {
    const result = VoiceClientMessageSchema.safeParse(validSpeak());
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'client.voice.speak') {
      expect(result.data.id as string).toBe('msg-1');
    }
  });

  test('rejects an empty-string sessionId', () => {
    expect(
      VoiceClientMessageSchema.safeParse({ ...validSpeak(), sessionId: '' })
        .success,
    ).toBe(false);
  });

  test('rejects a non-string sessionId', () => {
    expect(
      VoiceClientMessageSchema.safeParse({ ...validSpeak(), sessionId: 42 })
        .success,
    ).toBe(false);
  });

  test('rejects client.voice.speak with a missing id', () => {
    const { id: _omit, ...rest } = validSpeak();
    expect(VoiceClientMessageSchema.safeParse(rest).success).toBe(false);
  });

  test('rejects client.voice.speak with an empty-string id', () => {
    expect(
      VoiceClientMessageSchema.safeParse({ ...validSpeak(), id: '' }).success,
    ).toBe(false);
  });

  test('parses a client.audio_capture.audio_sent metadata frame (opaque data)', () => {
    expect(
      VoiceClientMessageSchema.safeParse({
        type: 'client.audio_capture.audio_sent',
        sessionId: 'session-1',
        timestamp: TS,
        data: new Uint8Array(0),
        sampleRate: 16000,
        encoding: 'linear16',
        sequence: 0,
        isFinal: false,
      }).success,
    ).toBe(true);
  });
});
