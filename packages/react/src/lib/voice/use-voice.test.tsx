import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMockConnector } from '../__tests__/mock-connector.js';
import { createMockVoiceConnector } from '../__tests__/mock-voice-connector.js';
import { createMaelstrom } from '../create-maelstrom.js';
import { resetWarnings } from '../warn-once.js';
import type { VoiceSessionState } from './use-voice-types.js';

// ─── Mock VoiceSession ──────────────────────────────────────────────────────

class MockVoiceSession {
  isAudioReady = false;
  private _listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor(_options: Record<string, unknown>) {}

  on(event: string, cb: (...args: unknown[]) => void): () => void {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(cb);
    return () => {
      const list = this._listeners.get(event);
      if (list) {
        const idx = list.indexOf(cb);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  private _emit(event: string, ...args: unknown[]) {
    for (const cb of this._listeners.get(event) ?? []) {
      cb(...args);
    }
  }

  _prepareAudioError: Error | null = null;

  async prepareAudio() {
    if (this._prepareAudioError) throw this._prepareAudioError;
    this.isAudioReady = true;
  }

  async startListening() {
    // no-op
  }

  stopListening() {
    // no-op
  }

  interrupt() {
    // no-op
  }

  destroy() {
    // no-op
  }

  // Test helpers
  _simulateStateChange(state: VoiceSessionState) {
    this._emit('stateChange', state);
  }

  _simulateTranscript(text: string, isFinal: boolean) {
    this._emit('transcript', text, isFinal);
  }
}

let mockVoiceSessionInstance: MockVoiceSession | null = null;

// Mock the dynamic import of @maelstrom-co/voice
mock.module('@maelstrom-co/voice', () => ({
  VoiceSession: class extends MockVoiceSession {
    constructor(opts: Record<string, unknown>) {
      super(opts);
      mockVoiceSessionInstance = this;
    }
  },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function flushPromises() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('m.useVoice()', () => {
  beforeEach(() => {
    mockVoiceSessionInstance = null;
    resetWarnings();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns idle state with isVoiceSupported true when connector has voice capability', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice(), { wrapper });
    await act(async () => {});

    expect(result.current.state).toBe('idle');
    expect(result.current.isVoiceSupported).toBe(true);
    expect(result.current.isReady).toBe(false);
  });

  it('useVoice({}) with empty options does not claim ownership', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice({}), { wrapper });

    await act(async () => {
      await flushPromises();
    });

    // Empty options should behave as observer — no session created
    expect(result.current.isReady).toBe(false);
    expect(mockVoiceSessionInstance).toBeNull();
  });

  it('returns isVoiceSupported false when connector lacks voice capability', async () => {
    const connector = createMockConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice(), { wrapper });
    await act(async () => {});

    expect(result.current.isVoiceSupported).toBe(false);
    expect(result.current.state).toBe('idle');
    expect(result.current.isReady).toBe(false);
  });

  it('useVoice(opts) triggers dynamic import and becomes ready', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice({ greeting: 'hello' }), {
      wrapper,
    });

    // Wait for dynamic import to resolve
    await act(async () => {
      await flushPromises();
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.isVoiceSupported).toBe(true);
    expect(mockVoiceSessionInstance).not.toBeNull();
  });

  it('owner and observer share state', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // Owner with options
    const { result: ownerResult } = renderHook(
      () => m.useVoice({ greeting: 'hi' }),
      {
        wrapper,
      },
    );

    // Observer without options
    const { result: observerResult } = renderHook(() => m.useVoice(), {
      wrapper,
    });

    // Wait for dynamic import
    await act(async () => {
      await flushPromises();
    });

    expect(ownerResult.current.isReady).toBe(true);
    expect(observerResult.current.isReady).toBe(true);

    // Simulate state change from the session
    await act(() => {
      mockVoiceSessionInstance!._simulateStateChange('listening');
    });

    expect(ownerResult.current.state).toBe('listening');
    expect(observerResult.current.state).toBe('listening');
  });

  it('owner unmount destroys session and resets observers to idle', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result: ownerResult, unmount: unmountOwner } = renderHook(
      () => m.useVoice({ greeting: 'hi' }),
      { wrapper },
    );

    const { result: observerResult } = renderHook(() => m.useVoice(), {
      wrapper,
    });

    // Wait for dynamic import
    await act(async () => {
      await flushPromises();
    });

    expect(ownerResult.current.isReady).toBe(true);
    expect(observerResult.current.isReady).toBe(true);

    const destroySpy = spyOn(mockVoiceSessionInstance!, 'destroy');

    // Unmount owner
    await act(() => {
      unmountOwner();
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(observerResult.current.isReady).toBe(false);
    expect(observerResult.current.state).toBe('idle');
  });

  it('unmount invokes every session unsubscribe exactly once', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { unmount } = renderHook(() => m.useVoice({ greeting: 'hi' }), {
      wrapper,
    });

    await act(async () => {
      await flushPromises();
    });

    expect(mockVoiceSessionInstance).not.toBeNull();

    // Count total listeners registered across all events by inspecting
    // the internal listener map on the mock.
    const sessionMock = mockVoiceSessionInstance as unknown as {
      _listeners: Map<string, ((...args: unknown[]) => void)[]>;
    };
    const totalBefore = Array.from(sessionMock._listeners.values()).reduce(
      (sum, list) => sum + list.length,
      0,
    );
    expect(totalBefore).toBeGreaterThan(0);

    await act(() => {
      unmount();
    });

    const totalAfter = Array.from(sessionMock._listeners.values()).reduce(
      (sum, list) => sum + list.length,
      0,
    );
    expect(totalAfter).toBe(0);
  });

  it('start/stop/interrupt are no-ops when session is null', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice(), { wrapper });
    await act(async () => {});

    // These should not throw
    await act(async () => {
      await result.current.start();
      result.current.stop();
      result.current.interrupt();
    });
  });

  it('second owner is rejected with a warning when first owner has active session', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // First owner
    renderHook(() => m.useVoice({ greeting: 'hi' }), { wrapper });
    await act(async () => {
      await flushPromises();
    });

    expect(mockVoiceSessionInstance).not.toBeNull();
    const firstSession = mockVoiceSessionInstance;

    // Second owner — should be rejected
    renderHook(() => m.useVoice({ greeting: 'hey' }), { wrapper });
    await act(async () => {
      await flushPromises();
    });

    // Session should not have changed — first owner retained
    expect(mockVoiceSessionInstance).toBe(firstSession);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('already owns the voice session'),
    );

    warnSpy.mockRestore();
  });

  it('second owner is rejected during import-pending window (before isReady)', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // First owner — do NOT flush promises, so import stays pending
    renderHook(() => m.useVoice({ greeting: 'hi' }), { wrapper });

    // Session should not exist yet (import still pending)
    expect(mockVoiceSessionInstance).toBeNull();

    // Second owner mounts while first is import-pending
    renderHook(() => m.useVoice({ greeting: 'hey' }), { wrapper });
    await act(async () => {
      await flushPromises();
    });

    // Warning should have fired for the second owner
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('already owns the voice session'),
    );

    warnSpy.mockRestore();
  });

  it('start() routes prepareAudio errors through onError instead of rejecting', async () => {
    const connector = createMockVoiceConnector();
    const onError = mock(() => {});
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(
      () => m.useVoice({ greeting: 'hi', onError }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    // Make prepareAudio fail (e.g. mic permission denied)
    const micError = new Error('Permission denied');
    mockVoiceSessionInstance!._prepareAudioError = micError;

    // start() is fire-and-forget — errors route through onError, never reject
    await act(async () => {
      result.current.start();
      await flushPromises();
    });

    expect(onError).toHaveBeenCalledWith(micError);
  });

  it('while dynamic import resolves, isReady is false and start is a no-op', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice({ greeting: 'hello' }), {
      wrapper,
    });

    // Immediately after render (before import resolves)
    expect(result.current.isReady).toBe(false);

    // start should be a no-op (no throw)
    await act(async () => {
      await result.current.start();
    });

    // Now let import resolve
    await act(async () => {
      await flushPromises();
    });

    expect(result.current.isReady).toBe(true);
  });

  it('start() calls prepareAudio then startListening in order', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVoice({ greeting: 'hi' }), {
      wrapper,
    });

    await act(async () => {
      await flushPromises();
    });

    const callOrder: string[] = [];
    const prepareAudioSpy = spyOn(
      mockVoiceSessionInstance!,
      'prepareAudio',
    ).mockImplementation(async () => {
      callOrder.push('prepareAudio');
      mockVoiceSessionInstance!.isAudioReady = true;
    });
    const startListeningSpy = spyOn(
      mockVoiceSessionInstance!,
      'startListening',
    ).mockImplementation(async () => {
      callOrder.push('startListening');
    });

    await act(async () => {
      result.current.start();
      await flushPromises();
    });

    expect(callOrder).toEqual(['prepareAudio', 'startListening']);

    // Second call should skip prepareAudio (isAudioReady is true)
    callOrder.length = 0;
    await act(async () => {
      result.current.start();
      await flushPromises();
    });

    expect(callOrder).toEqual(['startListening']);

    prepareAudioSpy.mockRestore();
    startListeningSpy.mockRestore();
  });

  it('owner callbacks still fire after an observer mounts', async () => {
    const connector = createMockVoiceConnector();
    const onStateChange = mock(() => {});
    const onTranscript = mock(() => {});
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // Owner with callbacks
    renderHook(
      () => m.useVoice({ greeting: 'hi', onStateChange, onTranscript }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    // Observer renders after owner — no options
    renderHook(() => m.useVoice(), { wrapper });

    // Trigger session events — owner callbacks should still fire
    await act(() => {
      mockVoiceSessionInstance!._simulateStateChange('listening');
    });

    expect(onStateChange).toHaveBeenCalledWith('listening');

    await act(() => {
      mockVoiceSessionInstance!._simulateTranscript('hello', true);
    });

    expect(onTranscript).toHaveBeenCalledWith('hello', true);
  });

  it('onTranscript and onStateChange callbacks are propagated from session', async () => {
    const connector = createMockVoiceConnector();
    const onTranscript = mock(() => {});
    const onStateChange = mock(() => {});
    const m = createMaelstrom({ vessels: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
      () => m.useVoice({ greeting: 'hi', onTranscript, onStateChange }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    // Simulate state change via session
    await act(() => {
      mockVoiceSessionInstance!._simulateStateChange('listening');
    });

    expect(onStateChange).toHaveBeenCalledWith('listening');

    // Simulate transcript via session
    await act(() => {
      mockVoiceSessionInstance!._simulateTranscript('hello world', true);
    });

    expect(onTranscript).toHaveBeenCalledWith('hello world', true);
  });
});
