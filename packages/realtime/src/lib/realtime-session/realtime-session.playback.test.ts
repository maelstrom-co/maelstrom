import { describe, expect, it } from 'bun:test';

import { makeHarness } from './__test-helpers__/realtime-session-harness.js';

describe('RealtimeSession playback control', () => {
  it('defaults playbackBlocked to false and treats resumePlayback as a no-op when adapter omits playbackControl', async () => {
    const { session } = makeHarness();
    expect(session.playbackBlocked).toBe(false);
    await session.resumePlayback();
    await session.connect();
    expect(session.playbackBlocked).toBe(false);
    await session.resumePlayback();
    await session.disconnect();
  });

  it('tracks blocked playback from the adapter, delegates resumePlayback, and resets on disconnect', async () => {
    const { session, adapter } = makeHarness();
    let blocked = false;
    let resumeCalls = 0;
    const listeners = new Set<() => void>();
    const setBlocked = (next: boolean) => {
      blocked = next;
      for (const listener of [...listeners]) listener();
    };
    Object.assign(adapter, {
      playbackControl: {
        isBlocked: () => blocked,
        subscribe: (handler: () => void) => {
          listeners.add(handler);
          return () => {
            listeners.delete(handler);
          };
        },
        resume: async () => {
          resumeCalls += 1;
          setBlocked(false);
        },
      },
    });

    const observed: boolean[] = [];
    const unsubscribe = session.on('playback_blocked', (next) => {
      observed.push(next);
    });

    // Disconnected resumePlayback does not reach the adapter.
    await session.resumePlayback();
    expect(resumeCalls).toBe(0);

    await session.connect();
    expect(session.playbackBlocked).toBe(false);

    setBlocked(true);
    expect(session.playbackBlocked).toBe(true);
    expect(observed).toEqual([true]);

    await session.resumePlayback();
    expect(resumeCalls).toBe(1);
    expect(session.playbackBlocked).toBe(false);
    expect(observed).toEqual([true, false]);

    setBlocked(true);
    expect(session.playbackBlocked).toBe(true);
    await session.disconnect();
    expect(session.playbackBlocked).toBe(false);
    expect(listeners.size).toBe(0);
    expect(observed).toEqual([true, false, true, false]);

    // A stale callback from a disconnected generation cannot flip playbackBlocked back.
    setBlocked(true);
    expect(session.playbackBlocked).toBe(false);
    expect(observed).toEqual([true, false, true, false]);
    unsubscribe();
  });

  it('stops delivering a superseded playback_blocked value when a handler disconnects', async () => {
    const { session, adapter } = makeHarness();
    let blocked = false;
    const listeners = new Set<() => void>();
    const setBlocked = (next: boolean) => {
      blocked = next;
      for (const listener of [...listeners]) listener();
    };
    Object.assign(adapter, {
      playbackControl: {
        isBlocked: () => blocked,
        subscribe: (handler: () => void) => {
          listeners.add(handler);
          return () => {
            listeners.delete(handler);
          };
        },
        resume: async () => {
          setBlocked(false);
        },
      },
    });

    let ending: Promise<void> | undefined;
    const unsubscribeDisconnecting = session.on('playback_blocked', (next) => {
      if (next) ending = session.disconnect();
    });
    const observed: boolean[] = [];
    const unsubscribeObserver = session.on('playback_blocked', (next) => {
      observed.push(next);
    });

    await session.connect();
    setBlocked(true);

    expect(session.playbackBlocked).toBe(false);
    expect(observed).toEqual([false]);

    await ending;
    unsubscribeDisconnecting();
    unsubscribeObserver();
  });

  it('leaves playbackBlocked false when a superseded connect reads a blocked adapter', async () => {
    const { session, adapter } = makeHarness();
    let ending: Promise<void> | undefined;
    Object.assign(adapter, {
      playbackControl: {
        isBlocked: () => true,
        subscribe: () => {
          ending = session.disconnect();
          return () => undefined;
        },
        resume: async () => undefined,
      },
    });
    const observed: boolean[] = [];
    const unsubscribe = session.on('playback_blocked', (next) => {
      observed.push(next);
    });

    await session.connect().catch(() => undefined);
    await ending;

    expect(session.playbackBlocked).toBe(false);
    expect(observed).not.toContain(true);
    unsubscribe();
  });

  it('keeps notifying later playback_blocked subscribers when an earlier one throws', async () => {
    const { session, adapter } = makeHarness();
    let blocked = false;
    const listeners = new Set<() => void>();
    const setBlocked = (next: boolean) => {
      blocked = next;
      for (const listener of [...listeners]) listener();
    };
    Object.assign(adapter, {
      playbackControl: {
        isBlocked: () => blocked,
        subscribe: (handler: () => void) => {
          listeners.add(handler);
          return () => {
            listeners.delete(handler);
          };
        },
        resume: async () => {
          setBlocked(false);
        },
      },
    });

    const unsubscribeThrowing = session.on('playback_blocked', () => {
      throw new Error('subscriber failed');
    });
    const observed: boolean[] = [];
    const unsubscribeObserver = session.on('playback_blocked', (next) => {
      observed.push(next);
    });

    await session.connect();
    expect(() => setBlocked(true)).not.toThrow();
    expect(session.playbackBlocked).toBe(true);
    expect(observed).toEqual([true]);

    await session.resumePlayback();
    expect(session.playbackBlocked).toBe(false);
    expect(observed).toEqual([true, false]);

    unsubscribeThrowing();
    unsubscribeObserver();
    await session.disconnect();
  });

  it('fences stale adapter playback notifications that ignore unsubscribe after disconnect', async () => {
    const { session, adapter } = makeHarness();
    let blocked = false;
    let leakedHandler: (() => void) | undefined;
    Object.assign(adapter, {
      playbackControl: {
        isBlocked: () => blocked,
        subscribe: (handler: () => void) => {
          leakedHandler = handler;
          return () => {
            // Intentionally ignore unsubscribe to simulate a buggy/stale adapter.
          };
        },
        resume: async () => {},
      },
    });

    await session.connect();
    blocked = true;
    leakedHandler?.();
    expect(session.playbackBlocked).toBe(true);

    await session.disconnect();
    expect(session.playbackBlocked).toBe(false);

    // Late notification from the previous generation is ignored.
    blocked = true;
    leakedHandler?.();
    expect(session.playbackBlocked).toBe(false);
  });

  it('ignores a resume result that settles after the connect attempt failed', async () => {
    const { session, adapter } = makeHarness();
    let blocked = true;
    let finishResume!: () => void;
    Object.assign(adapter, {
      playbackControl: {
        isBlocked: () => blocked,
        subscribe: () => () => {},
        resume: () =>
          new Promise<void>((resolve) => {
            finishResume = resolve;
          }),
      },
    });
    const releaseConnect = adapter.gateConnect();
    adapter.failNextConnect();
    const connecting = session.connect().catch(() => {});
    expect(session.playbackBlocked).toBe(true);

    const resuming = session.resumePlayback();
    releaseConnect();
    await connecting;
    expect(session.state).toBe('error');
    expect(session.playbackBlocked).toBe(false);

    blocked = true;
    finishResume();
    await resuming;
    expect(session.playbackBlocked).toBe(false);
  });

  it('fences stale adapter playback notifications that ignore unsubscribe after a failed connect', async () => {
    const { session, adapter } = makeHarness();
    let blocked = false;
    let leakedHandler: (() => void) | undefined;
    Object.assign(adapter, {
      playbackControl: {
        isBlocked: () => blocked,
        subscribe: (handler: () => void) => {
          leakedHandler = handler;
          return () => {
            // Intentionally ignore unsubscribe to simulate a buggy/stale adapter.
          };
        },
        resume: async () => {},
      },
    });
    adapter.failNextConnect();

    await expect(session.connect()).rejects.toThrow('adapter connect failed');
    expect(session.state).toBe('error');

    blocked = true;
    leakedHandler?.();
    expect(session.playbackBlocked).toBe(false);
  });
});
