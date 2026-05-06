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
import { createMaelstrom } from '@maelstrom-co/react';
import { resetWarnings } from '@maelstrom-co/react/_testing';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMockVoiceConnector } from './__tests__/mock-voice-connector.js';
import { maelstromVoice } from './maelstrom-voice.js';
import type { UseVoiceOptions, VoiceSessionState } from './use-voice-types.js';

// ─── Mock VoiceSession ──────────────────────────────────────────────────────

class MockVoiceSession {
  isAudioReady = false;
  options: Record<string, unknown>;
  prepareAudioCalls = 0;
  greetingsSent: string[] = [];
  private _listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor(options: Record<string, unknown>) {
    this.options = options;
  }

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
    this.prepareAudioCalls++;
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

  _simulateResponse(r: { userMessage?: string; requestId: string }) {
    this._emit('response', r);
  }

  _simulateSpeechStarted(text: string) {
    this._emit('speechStarted', text);
  }

  _simulateAudioLevel(level: number) {
    this._emit('audioLevel', level);
  }

  _simulateError(err: unknown) {
    this._emit('error', err);
  }

  _simulateNeedsUserGesture(needsGesture: boolean) {
    this._emit('needsUserGesture', needsGesture);
  }

  // Mirrors the real `#handleServerReady` gate so React-layer tests catch
  // regressions where forwarding flips the consumer's autoAcquireMic value.
  // If React silently switched true→false, this no-ops on ready and the
  // assertions below would fail.
  async _simulateServerReady() {
    if (!this.options.autoAcquireMic) return;
    if (typeof this.options.greeting === 'string' && this.options.greeting) {
      this.greetingsSent.push(this.options.greeting);
    }
    await this.prepareAudio();
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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // Cast: empty `{}` is intentionally invalid per the discriminated union
    // (autoAcquireMic is required), but the runtime treats empty options as
    // observer ownership (`Object.keys(options).length > 0` check).
    const { result } = renderHook(
      () => m.useVoice({} as unknown as UseVoiceOptions),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    // Empty options should behave as observer — no session created
    expect(result.current.isReady).toBe(false);
    expect(mockVoiceSessionInstance).toBeNull();
  });

  it('returns isVoiceSupported false when connector lacks voice capability', async () => {
    const connector = createMockConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hello' }),
      {
        wrapper,
      },
    );

    // Wait for dynamic import to resolve
    await act(async () => {
      await flushPromises();
    });

    expect(result.current.isReady).toBe(true);
    expect(result.current.isVoiceSupported).toBe(true);
    expect(mockVoiceSessionInstance).not.toBeNull();
  });

  it('forwards autoAcquireMic: false to VoiceSession', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(() => m.useVoice({ autoAcquireMic: false }), { wrapper });

    await act(async () => {
      await flushPromises();
    });

    expect(mockVoiceSessionInstance?.options.autoAcquireMic).toBe(false);
  });

  it('forwards autoAcquireMic: true to VoiceSession', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(() => m.useVoice({ autoAcquireMic: true }), { wrapper });

    await act(async () => {
      await flushPromises();
    });

    expect(mockVoiceSessionInstance?.options.autoAcquireMic).toBe(true);
  });

  it('autoAcquireMic: false suppresses greeting + prepareAudio on server ready', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(() => m.useVoice({ autoAcquireMic: false }), { wrapper });

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      await mockVoiceSessionInstance!._simulateServerReady();
    });

    expect(mockVoiceSessionInstance!.prepareAudioCalls).toBe(0);
    expect(mockVoiceSessionInstance!.greetingsSent).toEqual([]);
    expect(mockVoiceSessionInstance!.isAudioReady).toBe(false);
  });

  it('autoAcquireMic: true emits greeting and acquires mic on server ready', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(() => m.useVoice({ autoAcquireMic: true, greeting: 'hello' }), {
      wrapper,
    });

    await act(async () => {
      await flushPromises();
    });

    await act(async () => {
      await mockVoiceSessionInstance!._simulateServerReady();
    });

    expect(mockVoiceSessionInstance!.prepareAudioCalls).toBe(1);
    expect(mockVoiceSessionInstance!.greetingsSent).toEqual(['hello']);
    expect(mockVoiceSessionInstance!.isAudioReady).toBe(true);
  });

  it('owner and observer share state', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // Owner with options
    const { result: ownerResult } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result: ownerResult, unmount: unmountOwner } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { unmount } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
      {
        wrapper,
      },
    );

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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // First owner
    renderHook(() => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }), {
      wrapper,
    });
    await act(async () => {
      await flushPromises();
    });

    expect(mockVoiceSessionInstance).not.toBeNull();
    const firstSession = mockVoiceSessionInstance;

    // Second owner — should be rejected
    renderHook(() => m.useVoice({ autoAcquireMic: true, greeting: 'hey' }), {
      wrapper,
    });
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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // First owner — do NOT flush promises, so import stays pending
    renderHook(() => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }), {
      wrapper,
    });

    // Session should not exist yet (import still pending)
    expect(mockVoiceSessionInstance).toBeNull();

    // Second owner mounts while first is import-pending
    renderHook(() => m.useVoice({ autoAcquireMic: true, greeting: 'hey' }), {
      wrapper,
    });
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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi', onError }),
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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hello' }),
      {
        wrapper,
      },
    );

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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
      {
        wrapper,
      },
    );

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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    // Owner with callbacks
    renderHook(
      () =>
        m.useVoice({
          autoAcquireMic: true,
          greeting: 'hi',
          onStateChange,
          onTranscript,
        }),
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
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
      () =>
        m.useVoice({
          autoAcquireMic: true,
          greeting: 'hi',
          onTranscript,
          onStateChange,
        }),
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

  it('propagates interim and final transcript updates in order', async () => {
    const connector = createMockVoiceConnector();
    const onTranscript = mock(() => {});
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
      () =>
        m.useVoice({
          autoAcquireMic: true,
          greeting: 'hi',
          onTranscript,
        }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    await act(() => {
      mockVoiceSessionInstance!._simulateTranscript(
        'show my lab results',
        false,
      );
      mockVoiceSessionInstance!._simulateTranscript(
        'show my lab results',
        true,
      );
    });

    expect(onTranscript).toHaveBeenCalledTimes(2);
    expect(onTranscript).toHaveBeenNthCalledWith(
      1,
      'show my lab results',
      false,
    );
    expect(onTranscript).toHaveBeenNthCalledWith(
      2,
      'show my lab results',
      true,
    );
  });

  it('onTranscript callback from rerender fires instead of stale closure — no ownerOptionsRef regression', async () => {
    const connector = createMockVoiceConnector();
    const callbackA = mock(() => {});
    const callbackB = mock(() => {});
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    let onTranscript = callbackA;
    const { rerender } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi', onTranscript }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    // Switch callback and rerender — ownerOptionsRef aliasing must pick up new ref
    onTranscript = callbackB;
    rerender();

    await act(() => {
      mockVoiceSessionInstance!._simulateTranscript('hello', true);
    });

    expect(callbackB).toHaveBeenCalledWith('hello', true);
    expect(callbackA).not.toHaveBeenCalled();
  });

  it('onResponse callback is propagated from session', async () => {
    const connector = createMockVoiceConnector();
    const onResponse = mock(() => {});
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi', onResponse }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    const response = { userMessage: 'hello', requestId: 'req-1' };
    await act(() => {
      mockVoiceSessionInstance!._simulateResponse(response);
    });

    expect(onResponse).toHaveBeenCalledWith(response);
  });

  it('onSpeechStarted callback is propagated from session', async () => {
    const connector = createMockVoiceConnector();
    const onSpeechStarted = mock(() => {});
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
      () =>
        m.useVoice({ autoAcquireMic: true, greeting: 'hi', onSpeechStarted }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    await act(() => {
      mockVoiceSessionInstance!._simulateSpeechStarted('partial text');
    });

    expect(onSpeechStarted).toHaveBeenCalledWith('partial text');
  });

  it('onAudioLevel callback is propagated from session', async () => {
    const connector = createMockVoiceConnector();
    const onAudioLevel = mock(() => {});
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
      () =>
        m.useVoice({ autoAcquireMic: true, greeting: 'hi', onAudioLevel }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    await act(() => {
      mockVoiceSessionInstance!._simulateAudioLevel(0.75);
    });

    expect(onAudioLevel).toHaveBeenCalledWith(0.75);
  });

  it('routes errors to console.error when no onError callback provided', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());
    const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(() => m.useVoice({ autoAcquireMic: true }), { wrapper });

    await act(async () => {
      await flushPromises();
    });

    const err = new Error('voice error');
    await act(() => {
      mockVoiceSessionInstance!._simulateError(err);
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      '[Maelstrom] Voice session error:',
      err,
    );

    consoleSpy.mockRestore();
  });

  describe('live-session actions route to the underlying session', () => {
    it('stop() forwards to session.stopListening()', async () => {
      const connector = createMockVoiceConnector();
      const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

      const wrapper = ({ children }: { children: ReactNode }) => (
        <m.Provider connector={connector}>{children}</m.Provider>
      );

      const { result } = renderHook(
        () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
        { wrapper },
      );

      await act(async () => {
        await flushPromises();
      });

      const stopSpy = spyOn(mockVoiceSessionInstance!, 'stopListening');
      result.current.stop();

      expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it('interrupt() forwards to session.interrupt()', async () => {
      const connector = createMockVoiceConnector();
      const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

      const wrapper = ({ children }: { children: ReactNode }) => (
        <m.Provider connector={connector}>{children}</m.Provider>
      );

      const { result } = renderHook(
        () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
        { wrapper },
      );

      await act(async () => {
        await flushPromises();
      });

      const interruptSpy = spyOn(mockVoiceSessionInstance!, 'interrupt');
      result.current.interrupt();

      expect(interruptSpy).toHaveBeenCalledTimes(1);
    });

    it('prepareAudio() forwards to session.prepareAudio()', async () => {
      const connector = createMockVoiceConnector();
      const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

      const wrapper = ({ children }: { children: ReactNode }) => (
        <m.Provider connector={connector}>{children}</m.Provider>
      );

      const { result } = renderHook(
        () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
        { wrapper },
      );

      await act(async () => {
        await flushPromises();
      });

      // mockVoiceSessionInstance.prepareAudioCalls is incremented inside the
      // mock's `prepareAudio()`. The hook's internal bootstrap may already
      // have called it once, so we capture the baseline rather than assuming
      // zero.
      const baseline = mockVoiceSessionInstance!.prepareAudioCalls;
      result.current.prepareAudio();
      await act(async () => {
        await flushPromises();
      });

      expect(mockVoiceSessionInstance!.prepareAudioCalls).toBe(baseline + 1);
    });
  });

  it('forwards full option set (language, vad, bargein, debug) to VoiceSession', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [], debug: true }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    renderHook(
      () =>
        m.useVoice({
          autoAcquireMic: true,
          greeting: 'hi',
          language: 'es-ES',
          useVadToFinalizeInterims: false,
          allowBargeIn: false,
          vadOptions: { minSpeechDurationSeconds: 0.42 },
        }),
      { wrapper },
    );

    await act(async () => {
      await flushPromises();
    });

    const opts = mockVoiceSessionInstance!.options as {
      language?: string;
      useVadToFinalizeInterims?: boolean;
      allowBargeIn?: boolean;
      vadOptions?: { activationThreshold?: number; minSpeechDurationSeconds?: number };
      debugMode?: boolean;
    };

    expect(opts.language).toBe('es-ES');
    expect(opts.useVadToFinalizeInterims).toBe(false);
    expect(opts.allowBargeIn).toBe(false);
    expect(opts.debugMode).toBe(true);
    // react-voice merges its activationThreshold default (0.5) under any
    // user-supplied override. Both fields should land on the session.
    expect(opts.vadOptions?.activationThreshold).toBe(0.5);
    expect(opts.vadOptions?.minSpeechDurationSeconds).toBe(0.42);
  });

  it('needsUserGesture event flips snapshot field and notifies observers', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result: ownerResult } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
      { wrapper },
    );

    const { result: observerResult } = renderHook(() => m.useVoice(), {
      wrapper,
    });

    await act(async () => {
      await flushPromises();
    });

    expect(ownerResult.current.needsUserGesture).toBe(false);
    expect(observerResult.current.needsUserGesture).toBe(false);

    await act(() => {
      mockVoiceSessionInstance!._simulateNeedsUserGesture(true);
    });

    // Owner AND observer both see the flip — verifies the event flows
    // through the shared store, not a per-hook subscription.
    expect(ownerResult.current.needsUserGesture).toBe(true);
    expect(observerResult.current.needsUserGesture).toBe(true);

    await act(() => {
      mockVoiceSessionInstance!._simulateNeedsUserGesture(false);
    });

    expect(ownerResult.current.needsUserGesture).toBe(false);
    expect(observerResult.current.needsUserGesture).toBe(false);
  });

  it('owner unmount clears needsUserGesture for observers', async () => {
    const connector = createMockVoiceConnector();
    const m = createMaelstrom({ vessels: [] }).with(maelstromVoice());

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { unmount: unmountOwner } = renderHook(
      () => m.useVoice({ autoAcquireMic: true, greeting: 'hi' }),
      { wrapper },
    );

    const { result: observerResult } = renderHook(() => m.useVoice(), {
      wrapper,
    });

    await act(async () => {
      await flushPromises();
    });

    await act(() => {
      mockVoiceSessionInstance!._simulateNeedsUserGesture(true);
    });

    expect(observerResult.current.needsUserGesture).toBe(true);

    await act(() => {
      unmountOwner();
    });

    // Reset wipes the field — the dialog should not linger after the
    // session is gone.
    expect(observerResult.current.needsUserGesture).toBe(false);
  });
});
