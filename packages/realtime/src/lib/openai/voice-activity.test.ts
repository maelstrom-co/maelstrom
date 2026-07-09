import { describe, expect, it } from 'bun:test';
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

  it('returns null for events that carry no activity meaning', () => {
    expect(deriveVoiceActivity('connected', 'session.updated')).toBeNull();
    expect(deriveVoiceActivity('speaking', 'rate_limits.updated')).toBeNull();
  });
});
