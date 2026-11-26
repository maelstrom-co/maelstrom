// @vitest-environment happy-dom

import { createMaelstrom } from '@maelstrom-co/react';
import {
  maelstromRealtime,
  type UseVoiceResult,
} from '@maelstrom-co/react-realtime';
import type {
  AdapterPlaybackControl,
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
} from '@maelstrom-co/realtime';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockConnector } from './__tests__/mock-connector';
import type { DemoVoiceProvider } from './voice-provider';

class FakeAdapter implements RealtimeProviderAdapter {
  readonly listeners = new Set<(event: RealtimeAdapterEvent) => void>();
  readonly playbackListeners = new Set<() => void>();
  readonly observations = { subscribe: () => () => {} };
  blocked = false;
  readonly resume = vi.fn(async () => {
    this.setBlocked(false);
  });
  readonly playbackControl?: AdapterPlaybackControl;

  constructor(supportsPlaybackControl = true) {
    if (supportsPlaybackControl) {
      this.playbackControl = {
        isBlocked: () => this.blocked,
        subscribe: (handler) => {
          this.playbackListeners.add(handler);
          return () => {
            this.playbackListeners.delete(handler);
          };
        },
        resume: () => this.resume(),
      };
    }
  }

  async connect() {
    for (const listener of [...this.listeners]) {
      listener({ type: 'state', state: 'connected' });
    }
  }

  async disconnect() {
    this.setBlocked(false);
    for (const listener of [...this.listeners]) {
      listener({ type: 'state', state: 'idle' });
    }
  }

  getAudioStreams() {
    return {};
  }

  injectGrounding() {}

  async sendToolResult() {}

  on(handler: (event: RealtimeAdapterEvent) => void) {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  setBlocked(next: boolean) {
    if (this.blocked === next) return;
    this.blocked = next;
    for (const listener of [...this.playbackListeners]) listener();
  }
}

function mountVoice(
  createAdapter: (provider: DemoVoiceProvider) => RealtimeProviderAdapter,
  initialProvider: DemoVoiceProvider = 'live',
) {
  const app = createMaelstrom({ vessels: [] as const }).with(
    maelstromRealtime({
      providers: ['live', 'realtime', 'livekit'] as const,
      initialProvider,
      createAdapter: ({ provider }) => createAdapter(provider),
    }),
  );
  let latest: UseVoiceResult<DemoVoiceProvider> | undefined;
  function Probe() {
    latest = app.useVoice();
    return null;
  }
  const utils = render(
    <app.Provider connector={createMockConnector()}>
      <Probe />
    </app.Provider>,
  );
  const voice = () => {
    if (!latest) throw new Error('useVoice has not rendered');
    return latest;
  };
  return { ...utils, voice };
}

afterEach(cleanup);

describe('useVoice playbackBlocked and resumePlayback', () => {
  it('reports false when the adapter does not expose playbackControl', async () => {
    const adapter = new FakeAdapter(false);
    const { voice } = mountVoice(() => adapter, 'livekit');
    await act(() => voice().connect());
    expect(voice().playbackBlocked).toBe(false);
    await act(() => voice().resumePlayback());
    expect(voice().playbackBlocked).toBe(false);
  });

  it('tracks blocked playback changes and resumes through useVoice().resumePlayback()', async () => {
    const adapter = new FakeAdapter(true);
    const { voice } = mountVoice(() => adapter, 'live');
    expect(voice().playbackBlocked).toBe(false);

    await act(() => voice().connect());
    expect(voice().playbackBlocked).toBe(false);

    act(() => adapter.setBlocked(true));
    expect(voice().playbackBlocked).toBe(true);

    await act(() => voice().resumePlayback());
    expect(adapter.resume).toHaveBeenCalledTimes(1);
    expect(voice().playbackBlocked).toBe(false);
  });

  it('resets playbackBlocked on disconnect and ignores stale adapter updates after provider switch', async () => {
    const live = new FakeAdapter(true);
    const realtime = new FakeAdapter(true);
    const { voice } = mountVoice(
      (provider) => (provider === 'live' ? live : realtime),
      'live',
    );

    await act(() => voice().connect());
    act(() => live.setBlocked(true));
    expect(voice().playbackBlocked).toBe(true);

    await act(() => voice().switchProvider('realtime'));
    expect(voice().playbackBlocked).toBe(false);
    expect(live.playbackListeners.size).toBe(0);

    // Late update on the previous adapter cannot mark the replacement blocked.
    act(() => live.setBlocked(true));
    expect(voice().playbackBlocked).toBe(false);

    await act(() => voice().connect());
    act(() => realtime.setBlocked(true));
    expect(voice().playbackBlocked).toBe(true);

    await act(() => voice().resumePlayback());
    expect(realtime.resume).toHaveBeenCalledTimes(1);
    expect(live.resume).not.toHaveBeenCalled();
    expect(voice().playbackBlocked).toBe(false);
  });

  it('unsubscribes from playbackControl on disconnect and unmount', async () => {
    const adapter = new FakeAdapter(true);
    const { voice, unmount } = mountVoice(() => adapter, 'live');
    await act(() => voice().connect());
    expect(adapter.playbackListeners.size).toBe(1);

    await act(() => voice().disconnect());
    expect(adapter.playbackListeners.size).toBe(0);

    await act(() => voice().connect());
    expect(adapter.playbackListeners.size).toBe(1);
    unmount();
    await act(async () => {});
    expect(adapter.playbackListeners.size).toBe(0);
  });
});
