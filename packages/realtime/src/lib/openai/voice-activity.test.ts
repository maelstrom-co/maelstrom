import { describe, expect, it } from 'bun:test';
import type { VoiceSessionState } from '@maelstrom-co/client';
import { deriveVoiceActivity } from './voice-activity.js';

describe('deriveVoiceActivity', () => {
  it('maps the happy-path turn: listen → think → speak → settle', () => {
    expect(deriveVoiceActivity('connected', 'input_audio_buffer.speech_started')).toBe('listening');
    expect(deriveVoiceActivity('listening', 'input_audio_buffer.speech_stopped')).toBe('thinking');
    expect(deriveVoiceActivity('thinking', 'output_audio_buffer.started')).toBe('speaking');
    expect(deriveVoiceActivity('speaking', 'output_audio_buffer.stopped')).toBe('connected');
  });

  it('keeps listening when a response spins up mid-user-speech', () => {
    expect(deriveVoiceActivity('listening', 'response.created')).toBeNull();
    expect(deriveVoiceActivity('connected', 'response.created')).toBe('thinking');
  });

  it('does not end speaking on response.done — audio may still be playing', () => {
    expect(deriveVoiceActivity('speaking', 'response.done')).toBeNull();
    expect(deriveVoiceActivity('thinking', 'response.done')).toBe('connected');
    expect(deriveVoiceActivity('thinking', 'response.cancelled')).toBe('connected');
  });

  it('handles barge-in: user speech during playback wins', () => {
    expect(deriveVoiceActivity('speaking', 'input_audio_buffer.speech_started')).toBe('listening');
  });

  it('settles on output buffer cleared (barge-in cancellation path)', () => {
    expect(deriveVoiceActivity('speaking', 'output_audio_buffer.cleared')).toBe('connected');
  });

  it('stays listening through a full barge-in interruption sequence instead of getting stomped back to connected', () => {
    // Realistic OpenAI barge-in: the user starts talking over playback
    // (speech_started -> listening), which cancels the in-flight response
    // (response.cancelled) and clears the output audio buffer
    // (output_audio_buffer.cleared) — both settle events, but the user is
    // still mid-utterance the whole time, so neither may force 'connected'.
    let state: VoiceSessionState = 'speaking';

    state = deriveVoiceActivity(state, 'input_audio_buffer.speech_started') ?? state;
    expect(state).toBe('listening');

    state = deriveVoiceActivity(state, 'response.cancelled') ?? state;
    expect(state).toBe('listening');

    state = deriveVoiceActivity(state, 'output_audio_buffer.cleared') ?? state;
    expect(state).toBe('listening');
  });

  it('returns null for every settle event while listening, leaving speech_stopped as the only way out', () => {
    for (const settleEvent of [
      'output_audio_buffer.stopped',
      'output_audio_buffer.cleared',
      'response.done',
      'response.cancelled',
    ]) {
      expect(deriveVoiceActivity('listening', settleEvent)).toBeNull();
    }
    expect(deriveVoiceActivity('listening', 'input_audio_buffer.speech_stopped')).toBe('thinking');
  });

  it('returns null for events that carry no activity meaning', () => {
    expect(deriveVoiceActivity('connected', 'session.updated')).toBeNull();
    expect(deriveVoiceActivity('speaking', 'rate_limits.updated')).toBeNull();
  });
});
