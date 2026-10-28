// @vitest-environment happy-dom

import type {
  RealtimeProviderAdapter,
  RealtimeSession,
} from '@maelstrom-co/realtime';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type LivePlayback = 'unavailable' | 'pending' | 'accepted' | 'blocked';

class FakeLiveAdapter {
  playback: LivePlayback = 'accepted';
  readonly listeners = new Set<() => void>();
  readonly generatedOpening = {
    readiness: {
      subscribe: (handler: () => void) => {
        this.listeners.add(handler);
        return () => {
          this.listeners.delete(handler);
        };
      },
    },
  };
  getTransportSnapshot() {
    return { playback: this.playback };
  }
  setPlayback(playback: LivePlayback) {
    this.playback = playback;
    for (const listener of [...this.listeners]) listener();
  }
}

vi.doMock('@maelstrom-co/realtime-openai-live', () => ({
  OpenAILiveAdapter: FakeLiveAdapter,
}));

const { registerDemoVoice } = await import('./demo-voice');
const { useLivePlaybackBlocked } = await import('./use-live-playback-blocked');

function liveSession(adapter: FakeLiveAdapter): RealtimeSession {
  const session = {} as RealtimeSession;
  registerDemoVoice(session, {
    provider: 'live',
    instanceId: 'instance',
    adapter: adapter as unknown as RealtimeProviderAdapter,
  } as Parameters<typeof registerDemoVoice>[1]);
  return session;
}

afterEach(cleanup);

describe('useLivePlaybackBlocked', () => {
  it('reports false for a session the demo did not build', () => {
    const { result } = renderHook(() =>
      useLivePlaybackBlocked({} as RealtimeSession),
    );
    expect(result.current).toBe(false);
  });

  it('reports false for a session whose adapter is not GPT-Live', () => {
    const session = {} as RealtimeSession;
    registerDemoVoice(session, {
      provider: 'realtime',
      instanceId: 'instance',
      adapter: {} as RealtimeProviderAdapter,
    } as Parameters<typeof registerDemoVoice>[1]);
    const { result } = renderHook(() => useLivePlaybackBlocked(session));
    expect(result.current).toBe(false);
  });

  it.each([
    ['unavailable', false],
    ['pending', false],
    ['accepted', false],
    ['blocked', true],
  ] as const)('reports %s playback as blocked=%s', (playback, blocked) => {
    const adapter = new FakeLiveAdapter();
    adapter.playback = playback;
    const session = liveSession(adapter);
    const { result } = renderHook(() => useLivePlaybackBlocked(session));
    expect(result.current).toBe(blocked);
  });

  it('follows playback changes the adapter announces', () => {
    const adapter = new FakeLiveAdapter();
    const session = liveSession(adapter);
    const { result } = renderHook(() => useLivePlaybackBlocked(session));
    expect(result.current).toBe(false);
    act(() => adapter.setPlayback('blocked'));
    expect(result.current).toBe(true);
    act(() => adapter.setPlayback('accepted'));
    expect(result.current).toBe(false);
  });

  it('moves its subscription to the adapter of a replacement session', () => {
    const first = new FakeLiveAdapter();
    const second = new FakeLiveAdapter();
    second.playback = 'blocked';
    const firstSession = liveSession(first);
    const secondSession = liveSession(second);
    const { result, rerender } = renderHook(
      ({ session }) => useLivePlaybackBlocked(session),
      { initialProps: { session: firstSession } },
    );
    expect(first.listeners.size).toBe(1);

    rerender({ session: secondSession });
    expect(result.current).toBe(true);
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);

    act(() => second.setPlayback('accepted'));
    expect(result.current).toBe(false);
  });

  it('unsubscribes on unmount', () => {
    const adapter = new FakeLiveAdapter();
    const session = liveSession(adapter);
    const { unmount } = renderHook(() => useLivePlaybackBlocked(session));
    expect(adapter.listeners.size).toBe(1);
    unmount();
    expect(adapter.listeners.size).toBe(0);
  });
});
