import { describe, expect, it } from 'bun:test';
import type { TimedTranscriptFragment } from '@maelstrom-co/client';

import { TranscriptObservationFeed } from './transcript-observation-feed.js';

function harness(options: { maxTrackedUtterances?: number } = {}) {
  let clock = 1000;
  const feed = new TranscriptObservationFeed({
    now: () => clock,
    ...options,
  });
  const fragments: TimedTranscriptFragment[] = [];
  feed.subscribe((event) => {
    if (event.type === 'fragment') fragments.push(event.fragment);
  });
  return {
    feed,
    fragments,
    advance(ms: number) {
      clock += ms;
    },
  };
}

describe('TranscriptObservationFeed', () => {
  it('publishes the text so far under one id with receipt times since the timeline start', () => {
    const h = harness();
    h.advance(100);
    h.feed.append('item-1', 'assistant', 'Hel');
    h.advance(50);
    h.feed.append('item-1', 'assistant', 'lo');

    expect(h.fragments).toEqual([
      {
        id: 'item-1',
        role: 'assistant',
        speakerId: 'assistant',
        text: 'Hel',
        startMs: 100,
        endMs: 100,
      },
      {
        id: 'item-1',
        role: 'assistant',
        speakerId: 'assistant',
        text: 'Hello',
        startMs: 100,
        endMs: 150,
      },
    ]);
  });

  it('revises the streamed fragment on completion instead of appending the full text', () => {
    const h = harness();
    h.feed.append('item-1', 'user', 'turn the ');
    h.feed.append('item-1', 'user', 'lights');
    h.advance(20);
    h.feed.complete('item-1', 'user', 'Turn the lights on.');

    expect(h.fragments.at(-1)).toEqual({
      id: 'item-1',
      role: 'user',
      speakerId: 'user',
      text: 'Turn the lights on.',
      startMs: 0,
      endMs: 20,
      final: true,
    });
  });

  it('ignores deltas that arrive after completion', () => {
    const h = harness();
    h.feed.complete('item-1', 'assistant', 'Done.');
    h.feed.append('item-1', 'assistant', ' late');

    expect(h.fragments.map((fragment) => fragment.text)).toEqual(['Done.']);
  });

  it('publishes an unseen completed utterance whole, but not an empty one', () => {
    const h = harness();
    h.feed.complete('empty', 'user', '');
    h.advance(5);
    h.feed.complete('item-2', 'user', 'Hi');

    expect(h.fragments).toEqual([
      {
        id: 'item-2',
        role: 'user',
        speakerId: 'user',
        text: 'Hi',
        startMs: 5,
        endMs: 5,
        final: true,
      },
    ]);
  });

  it('revises a streamed utterance to empty text when the provider says so', () => {
    const h = harness();
    h.feed.append('item-1', 'user', 'uh');
    h.feed.complete('item-1', 'user', '');

    expect(h.fragments.at(-1)).toMatchObject({ text: '', final: true });
  });

  it('skips empty deltas', () => {
    const h = harness();
    h.feed.append('item-1', 'user', '');

    expect(h.fragments).toEqual([]);
  });

  it('restarts the timeline at zero and forgets earlier utterances', () => {
    const h = harness();
    h.advance(500);
    h.feed.append('item-1', 'user', 'old');
    h.feed.restart();
    h.advance(30);
    h.feed.append('item-1', 'user', 'new');

    expect(h.fragments.at(-1)).toMatchObject({
      text: 'new',
      startMs: 30,
      endMs: 30,
    });
  });

  it('forgets the oldest utterance beyond its tracking bound', () => {
    const h = harness({ maxTrackedUtterances: 2 });
    h.feed.append('a', 'user', 'a1');
    h.feed.append('b', 'user', 'b1');
    h.feed.append('c', 'user', 'c1');
    h.feed.append('a', 'user', 'a2');
    h.feed.append('c', 'user', 'c2');

    expect(h.fragments.slice(-2).map((fragment) => fragment.text)).toEqual([
      'a2',
      'c1c2',
    ]);
  });

  it('isolates a throwing observer and stops delivering after unsubscribe', () => {
    const feed = new TranscriptObservationFeed({ now: () => 0 });
    const seen: string[] = [];
    feed.subscribe(() => {
      throw new Error('observer failed');
    });
    const release = feed.subscribe((event) => {
      if (event.type === 'fragment') seen.push(event.fragment.text);
    });

    feed.complete('a', 'assistant', 'one');
    release();
    feed.complete('b', 'assistant', 'two');

    expect(seen).toEqual(['one']);
  });

  it('publishes frozen fragments so observers cannot change tracked text', () => {
    const h = harness();
    h.feed.append('a', 'user', 'x');

    expect(Object.isFrozen(h.fragments[0])).toBe(true);
  });

  it('rejects a non-positive tracking bound', () => {
    expect(
      () => new TranscriptObservationFeed({ maxTrackedUtterances: 0 }),
    ).toThrow(RangeError);
  });
});
