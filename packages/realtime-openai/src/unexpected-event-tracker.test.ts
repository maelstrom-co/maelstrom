import { describe, expect, it } from 'bun:test';

import { createUnexpectedEventTracker } from './unexpected-event-tracker.js';

describe('track', () => {
  it('warns (returns true) on the first sighting of an unexpected type', () => {
    const tracker = createUnexpectedEventTracker();
    expect(tracker.track('some.unmapped.event')).toBe(true);
  });

  it('does not warn again on repeat sightings of the same type', () => {
    const tracker = createUnexpectedEventTracker();
    tracker.track('some.unmapped.event');
    expect(tracker.track('some.unmapped.event')).toBe(false);
    expect(tracker.track('some.unmapped.event')).toBe(false);
  });

  it('warns once per distinct unexpected type', () => {
    const tracker = createUnexpectedEventTracker();
    expect(tracker.track('type.a')).toBe(true);
    expect(tracker.track('type.b')).toBe(true);
    expect(tracker.track('type.a')).toBe(false);
    expect(tracker.track('type.b')).toBe(false);
  });

  it('never flags allowlisted known-benign unmapped types', () => {
    const tracker = createUnexpectedEventTracker();
    const benignTypes = [
      'session.created',
      'session.updated',
      'response.created',
      'response.done',
      'response.cancelled',
      'response.output_item.added',
      'response.output_item.done',
      'response.content_part.added',
      'response.content_part.done',
      'response.function_call_arguments.delta',
      'response.audio.delta',
      'response.audio.done',
      'response.output_audio.delta',
      'response.output_audio.done',
      'response.text.delta',
      'response.text.done',
      'output_audio_buffer.started',
      'output_audio_buffer.stopped',
      'output_audio_buffer.cleared',
      'input_audio_buffer.speech_stopped',
      'input_audio_buffer.committed',
      'conversation.item.created',
      'conversation.item.added',
      'conversation.item.done',
      'conversation.item.deleted',
      'rate_limits.updated',
    ];
    for (const type of benignTypes) {
      expect(tracker.track(type)).toBe(false);
      expect(tracker.track(type)).toBe(false);
    }
  });
});

describe('snapshot', () => {
  it('accumulates occurrence counts per distinct unexpected type', () => {
    const tracker = createUnexpectedEventTracker();
    tracker.track('type.a');
    tracker.track('type.a');
    tracker.track('type.b');
    tracker.track('type.a');

    expect(tracker.snapshot()).toEqual(
      new Map([
        ['type.a', 3],
        ['type.b', 1],
      ]),
    );
  });

  it('does not count allowlisted types', () => {
    const tracker = createUnexpectedEventTracker();
    tracker.track('session.created');
    tracker.track('type.a');

    expect(tracker.snapshot()).toEqual(new Map([['type.a', 1]]));
  });

  it('returns a snapshot that is unaffected by later tracking', () => {
    const tracker = createUnexpectedEventTracker();
    tracker.track('type.a');
    const snapshot = tracker.snapshot();
    tracker.track('type.a');
    tracker.track('type.b');

    expect(snapshot).toEqual(new Map([['type.a', 1]]));
  });
});
