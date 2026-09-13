import { describe, expect, it } from 'bun:test';
import type {
  TimedTranscriptFragment,
  VoiceApplicationWork,
  VoiceMediaObservation,
} from '@maelstrom-co/client';
import { VoiceObservationStore } from './voice-observation-store.js';

function fragment(
  id: string,
  text: string,
  startMs: number,
  options: Partial<TimedTranscriptFragment> = {},
): TimedTranscriptFragment {
  return {
    id,
    text,
    startMs,
    endMs: startMs + 100,
    role: 'assistant',
    speakerId: 'assistant',
    ...options,
  };
}

describe('continuous voice observations', () => {
  it('keeps unchanged media evidence from rerendering observers', () => {
    const store = new VoiceObservationStore();
    store.media({ microphone: 'active', userSpeech: 'inactive' });
    const snapshot = store.getSnapshot();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });
    const metadataOnly = { metadata: new Uint8Array(1024) };
    const updates: Partial<VoiceMediaObservation>[] = [
      {},
      snapshot.media,
      { microphone: 'active' },
      metadataOnly as Partial<VoiceMediaObservation>,
    ];
    for (const update of updates) {
      store.media(update);
      expect(store.getSnapshot()).toBe(snapshot);
      expect(notifications).toBe(0);
    }
    store.media({ incomingAudio: 'active' });
    expect(notifications).toBe(1);
    expect(store.getSnapshot().media).toEqual({
      microphone: 'active',
      userSpeech: 'inactive',
      incomingAudio: 'active',
    });
  });

  it('projects host application work without retaining attached metadata', () => {
    const work = {
      planning: 'active' as const,
      applying: 'inactive' as const,
      metadata: new Uint8Array(1024),
    };
    const store = new VoiceObservationStore(
      {},
      { getSnapshot: () => work, subscribe: () => () => {} },
    );
    const snapshot = store.getSnapshot();
    expect(Object.keys(snapshot.applicationWork).sort()).toEqual([
      'applying',
      'planning',
    ]);
    expect(snapshot.applicationWork).toEqual({
      planning: 'active',
      applying: 'inactive',
    });
    expect(store.getSnapshot()).toBe(snapshot);
    expect(Object.isFrozen(snapshot.applicationWork)).toBe(true);
  });

  it('defers reentrant subscriptions until the next notification so one event cannot block the browser', () => {
    const store = new VoiceObservationStore();
    let calls = 0;
    let release = () => {};
    const listener = () => {
      calls += 1;
      release();
      if (calls < 1000) release = store.subscribe(listener);
    };
    release = store.subscribe(listener);
    let healthyCalls = 0;
    const releaseThrowing = store.subscribe(() => {
      throw new Error('observer failed');
    });
    const releaseHealthy = store.subscribe(() => {
      healthyCalls += 1;
    });
    store.media({ microphone: 'active' });
    expect(calls).toBe(1);
    expect(healthyCalls).toBe(1);
    store.media({ microphone: 'inactive' });
    expect(calls).toBe(2);
    expect(healthyCalls).toBe(2);
    release();
    releaseThrowing();
    releaseHealthy();
  });

  it('excludes adapter metadata so transcript limits bound retained data', () => {
    const store = new VoiceObservationStore({
      maxFragments: 1,
      maxFragmentChars: 1,
    });
    const raw = {
      ...fragment('a', '\n', 12, { endMs: 34, final: false }),
      metadata: new Uint8Array(8 * 1024 * 1024),
    };
    expect(store.fragment(raw)).toBe(true);
    const snapshot = store.getSnapshot();
    expect(Object.keys(snapshot.fragments[0]).sort()).toEqual([
      'endMs',
      'final',
      'id',
      'role',
      'speakerId',
      'startMs',
      'text',
    ]);
    expect(snapshot.fragments[0]).toEqual(
      fragment('a', '\n', 12, { endMs: 34, final: false }),
    );
    store.fragment({ ...raw, text: '!', endMs: 45, final: true });
    expect(store.getSnapshot().fragments).toEqual([
      fragment('a', '!', 12, { endMs: 45, final: true }),
    ]);
    expect(snapshot.fragments[0].text).toBe('\n');
    expect(snapshot.captions[0].final).toBe(false);
    expect(Object.isFrozen(store.getSnapshot().fragments[0])).toBe(true);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('bounds media keys across updates with distinct adapter metadata', () => {
    const store = new VoiceObservationStore();
    store.media({ userSpeech: 'inactive', incomingAudio: 'active' });
    const snapshot = store.getSnapshot();
    const metadata = new Uint8Array(8 * 1024 * 1024);
    for (let i = 0; i < 1000; i++) {
      const media = {
        microphone: 'active' as const,
        [`metadata${i}`]: metadata,
      };
      store.media(media);
    }
    expect(Object.keys(store.getSnapshot().media)).toHaveLength(3);
    expect(store.getSnapshot().media).toEqual({
      microphone: 'active',
      userSpeech: 'inactive',
      incomingAudio: 'active',
    });
    expect(snapshot.media.microphone).toBe('unknown');
    expect(Object.isFrozen(store.getSnapshot().media)).toBe(true);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('preserves exact deltas and overlapping speakers without inventing turns', () => {
    const store = new VoiceObservationStore();
    store.begin();
    store.fragment(fragment('a', 'Hello', 0));
    const assistantId = store.getSnapshot().captions[0].id;
    store.fragment(
      fragment('u', 'wait!', 20, { role: 'user', speakerId: 'user' }),
    );
    store.fragment(fragment('b', ',  world\n', 100));
    expect(store.getSnapshot().captions).toMatchObject([
      { id: assistantId, text: 'Hello,  world\n', final: false },
      { text: 'wait!', final: false },
    ]);
    expect(store.getSnapshot().fragments.map((entry) => entry.text)).toEqual([
      'Hello',
      'wait!',
      ',  world\n',
    ]);
  });

  it('inserts late fragments and merges groups using the oldest surviving display identity', () => {
    const store = new VoiceObservationStore({ groupGapMs: 100 });
    store.begin();
    store.fragment(fragment('later', 'C', 400));
    const oldestId = store.getSnapshot().captions[0].id;
    store.fragment(fragment('earlier', 'A', 0));
    expect(store.getSnapshot().captions).toHaveLength(2);
    store.fragment(fragment('bridge', 'B', 200, { endMs: 300 }));
    expect(store.getSnapshot().captions).toMatchObject([
      { id: oldestId, text: 'ABC', startMs: 0, endMs: 500 },
    ]);
    store.fragment(fragment('prefix', '  ', 0, { endMs: 0 }));
    expect(store.getSnapshot().captions[0]).toMatchObject({
      id: oldestId,
      text: 'A  BC',
    });
  });

  it('keeps equal-timestamp deltas in receipt order even when IDs sort differently or a fragment is revised', () => {
    const store = new VoiceObservationStore();
    store.fragment(fragment('2', 'first', 0));
    store.fragment(fragment('10', ' second', 0));
    store.fragment(fragment('2', 'First', 0));
    expect(store.getSnapshot().captions[0].text).toBe('First second');
  });

  it('revises a fragment without duplication and splits only on explicit final evidence', () => {
    const store = new VoiceObservationStore();
    store.fragment(fragment('a', 'one', 0));
    const id = store.getSnapshot().captions[0].id;
    store.fragment(fragment('b', ' two', 200));
    store.fragment(fragment('a', 'One.', 0, { final: true }));
    expect(store.getSnapshot().fragments).toHaveLength(2);
    expect(store.getSnapshot().captions).toMatchObject([
      { id, text: 'One.', final: true },
      { text: ' two', final: false },
    ]);
    store.fragment(fragment('c', 'After a display fade', 10000));
    expect(store.getSnapshot().captions[1].final).toBe(false);
    expect(store.getSnapshot().captions[2].final).toBe(false);
  });

  it('bounds retained data by media time and rejects invalid or oversized fragments without changing raw text', () => {
    const store = new VoiceObservationStore({
      maxFragments: 2,
      maxFragmentChars: 4,
    });
    store.fragment(fragment('a', 'a', 0));
    store.fragment(fragment('b', 'b', 100));
    store.fragment(fragment('c', 'c', 200));
    store.fragment(fragment('late', 'late', 0));
    expect(store.getSnapshot().fragments.map((entry) => entry.id)).toEqual([
      'b',
      'c',
    ]);
    const snapshot = store.getSnapshot();
    for (const invalid of [
      fragment('bad', '12345', 300),
      fragment('bad', '', Number.NaN),
      fragment('bad', '', -1),
      fragment('bad', '', 1, { endMs: 0 }),
    ]) {
      expect(store.fragment(invalid)).toBe(false);
      expect(store.getSnapshot()).toBe(snapshot);
    }
    expect(() => new VoiceObservationStore({ maxFragments: 0 })).toThrow(
      RangeError,
    );
    expect(() => new VoiceObservationStore({ groupGapMs: Infinity })).toThrow(
      RangeError,
    );
  });

  it('clears generation-scoped media and captions without claiming application completion', () => {
    let work: VoiceApplicationWork = {
      planning: 'active',
      applying: 'unknown',
    };
    const listeners = new Set<() => void>();
    const store = new VoiceObservationStore(
      {},
      {
        getSnapshot: () => work,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    );
    const seen: VoiceApplicationWork[] = [];
    const release = store.subscribe(() =>
      seen.push(store.getSnapshot().applicationWork),
    );
    const releaseSecond = store.subscribe(() => {});
    expect(listeners.size).toBe(1);
    store.begin();
    store.media({ microphone: 'active', incomingAudio: 'active' });
    store.fragment(fragment('a', 'pending', 0));
    store.connection('disconnected');
    expect(store.getSnapshot()).toMatchObject({
      media: { microphone: 'unknown', incomingAudio: 'unknown' },
      applicationWork: { planning: 'active' },
    });
    work = { planning: 'inactive', applying: 'active' };
    for (const listener of listeners) listener();
    expect(seen.at(-1)).toEqual(work);
    store.begin();
    expect(store.getSnapshot()).toMatchObject({
      generation: 2,
      fragments: [],
      captions: [],
      applicationWork: work,
    });
    release();
    expect(listeners.size).toBe(1);
    releaseSecond();
    expect(listeners.size).toBe(0);
  });

  it('notifies observers even when another host listener reads the new work snapshot first', () => {
    let work: VoiceApplicationWork = {
      planning: 'inactive',
      applying: 'inactive',
    };
    let notifyHost: (() => void) | undefined;
    const store = new VoiceObservationStore(
      {},
      {
        getSnapshot: () => work,
        subscribe: (handler) => {
          notifyHost = handler;
          return () => {};
        },
      },
    );
    let notifications = 0;
    const release = store.subscribe(() => {
      notifications += 1;
    });
    store.getSnapshot();
    work = { planning: 'active', applying: 'inactive' };
    expect(store.getSnapshot().applicationWork).toEqual(work);
    notifyHost?.();
    expect(notifications).toBe(1);
    release();
  });
});
