import { describe, expect, test } from 'bun:test';
import type { VoiceSessionAudioDroppedEvent } from './types.js';
import { createVoiceSessionEvents } from './voice-session-events.js';

describe('voice-session-events', () => {
  test('does not expose the mutable listener registry', () => {
    const events = createVoiceSessionEvents({});

    expect(Object.hasOwn(events, 'listeners')).toBe(false);
  });

  test('traces secondary onError failures after a trace callback error', () => {
    const seenTraceEvents: Array<{
      event: string;
      details?: Record<string, unknown>;
    }> = [];
    const events = createVoiceSessionEvents(
      {
        onError() {
          throw new Error('onError failed');
        },
      },
      (event, details) => {
        if (event === 'callback.onError.failed') {
          seenTraceEvents.push({ event, details });
          return;
        }

        throw new Error('trace failed');
      },
    );

    events.trace('voice.state_change', { nextState: 'listening' });

    expect(seenTraceEvents).toEqual([
      {
        event: 'callback.onError.failed',
        details: expect.objectContaining({
          message:
            'Voice session trace callback failed for "voice.state_change"',
          callbackError: 'onError failed',
          sourceEvent: 'voice.state_change',
        }),
      },
    ]);
  });

  test('stops forwarding dropped-audio events after destroy', () => {
    const seen: VoiceSessionAudioDroppedEvent[] = [];
    const callbackSeen: VoiceSessionAudioDroppedEvent[] = [];
    const events = createVoiceSessionEvents({
      onAudioDropped(event) {
        callbackSeen.push(event);
      },
    });

    events.onAudioDropped((event) => {
      seen.push(event);
    });

    const firstEvent: VoiceSessionAudioDroppedEvent = {
      type: 'audio_dropped',
      droppedDurationMs: 50,
      reason: 'state_not_listening',
    };

    events.emitAudioDropped(firstEvent);
    events.destroy();
    events.emitAudioDropped({
      type: 'audio_dropped',
      droppedDurationMs: 75,
      reason: 'reconnect_buffer_full',
    });

    expect(seen).toEqual([firstEvent]);
    expect(callbackSeen).toEqual([firstEvent]);
  });
});
