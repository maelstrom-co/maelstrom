import { describe, expect, test } from 'bun:test';

import { createTTSSessionManager } from './tts-session-manager.js';
import type {
  SpeechOptions,
  SpeechStart,
  SpeechSynthesisHandle,
  TTSEvent,
  TTSProvider,
  VoiceSessionState,
} from './types.js';
import { isVoiceSessionQueuedTurnsDroppedError } from './types.js';

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

class MockTTSProvider implements TTSProvider {
  readonly name = 'mock-tts';
  readonly capabilities = { streamingTts: true };

  private connected = false;
  private listeners = new Set<(event: TTSEvent) => void>();
  readonly spokenTexts: string[] = [];
  stopCalls = 0;
  throwOnConnect = false;
  throwOnStop = false;
  private nextSpeakError: Error | null = null;
  private activeSpeak: {
    completionSettled: boolean;
    resolveCompletion: (reason: 'completed' | 'stopped') => void;
    rejectCompletion: (error: Error) => void;
  } | null = null;

  async connect(): Promise<void> {
    if (this.throwOnConnect) {
      throw new Error('connect failed');
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onEvent(callback: (event: TTSEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  speak(text: string, options?: SpeechOptions): SpeechSynthesisHandle {
    if (this.nextSpeakError) {
      const error = this.nextSpeakError;
      this.nextSpeakError = null;
      throw error;
    }

    this.spokenTexts.push(text);

    let resolveCompletion!: (reason: 'completed' | 'stopped') => void;
    let rejectCompletion!: (error: Error) => void;
    const completion = new Promise<'completed' | 'stopped'>(
      (resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      },
    );

    this.activeSpeak = {
      completionSettled: false,
      resolveCompletion,
      rejectCompletion,
    };

    return {
      speech: {
        text,
        format: 'pcm_f32le',
        sampleRate: options?.sampleRate ?? 16000,
        queued: false,
      },
      completion,
    };
  }

  stop(): void {
    this.stopCalls += 1;

    if (this.throwOnStop) {
      throw new Error('stop failed');
    }

    this.settleActiveSpeak('stopped');
  }

  settleActiveSpeak(reason: 'completed' | 'stopped'): void {
    if (!this.activeSpeak || this.activeSpeak.completionSettled) {
      return;
    }

    this.activeSpeak.completionSettled = true;
    this.activeSpeak.resolveCompletion(reason);
    this.activeSpeak = null;
  }

  rejectActiveSpeak(error = new Error('completion failed')): void {
    if (!this.activeSpeak || this.activeSpeak.completionSettled) {
      return;
    }

    this.activeSpeak.completionSettled = true;
    this.activeSpeak.rejectCompletion(error);
    this.activeSpeak = null;
  }

  failNextSpeak(error = new Error('speak failed')): void {
    this.nextSpeakError = error;
  }
}

function createManager() {
  const tts = new MockTTSProvider();
  const asyncFailures: Array<{
    event: string;
    error: unknown;
    details?: Record<string, unknown>;
  }> = [];
  const voiceStates: VoiceSessionState[] = [];
  const traceEvents: Array<{
    event: string;
    details?: Record<string, unknown>;
  }> = [];
  const speechStarts: string[] = [];
  const speechStartEvents: SpeechStart[] = [];
  const speechStops: boolean[] = [];
  let destroyed = false;
  let currentState: VoiceSessionState = 'idle';

  const manager = createTTSSessionManager(tts, {
    isDestroyed: () => destroyed,
    getVoiceState: () => currentState,
    setVoiceState(state) {
      currentState = state;
      voiceStates.push(state);
    },
    trace(event, details) {
      traceEvents.push({ event, details });
    },
    reportError() {},
    reportAsyncFailure(event, error, details) {
      asyncFailures.push({ event, error, details });
    },
    notifyCallbackSafely(callback, _traceEvent, ...args) {
      callback?.(...args);
    },
    emitAudioOutput() {
      return 0;
    },
    onSpeechStarted(speech) {
      speechStarts.push(speech.text);
      speechStartEvents.push(speech);
    },
    onSpeechStopped(completed) {
      speechStops.push(completed);
    },
  });

  return {
    manager,
    asyncFailures,
    markDestroyed() {
      destroyed = true;
      manager.destroy();
    },
    speechStarts,
    speechStartEvents,
    speechStops,
    tts,
    traceEvents,
    voiceStates,
  };
}

describe('tts-session-manager', () => {
  test('drains an enqueued successor after the active turn completes', async () => {
    const { manager, speechStarts, speechStops, tts, voiceStates } =
      createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');

    expect(tts.spokenTexts).toEqual(['A']);
    expect(speechStarts).toEqual(['A']);
    expect(voiceStates.at(-1)).toBe('speaking');

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(tts.spokenTexts).toEqual(['A', 'B']);
    expect(speechStarts).toEqual(['A', 'B']);
    expect(speechStops).toEqual([true]);

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(speechStops).toEqual([true, true]);
    expect(voiceStates.at(-1)).toBe('idle');
  });

  test('marks every queued successor in a multi-turn chain', async () => {
    const { manager, speechStartEvents, tts } = createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');
    manager.enqueueSpeak('C');

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(
      speechStartEvents.map((speech) => ({
        text: speech.text,
        queued: speech.queued,
      })),
    ).toEqual([
      { text: 'A', queued: false },
      { text: 'B', queued: true },
      { text: 'C', queued: true },
    ]);
  });

  test('reports queued-turn drops when a queued successor fails mid-chain', async () => {
    const { asyncFailures, manager, traceEvents, tts } = createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');
    manager.enqueueSpeak('C');
    tts.failNextSpeak(new Error('provider down'));

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();
    await flushMicrotasks();

    expect(traceEvents).toContainEqual(
      expect.objectContaining({
        event: 'tts.queued_turns.dropped',
        details: expect.objectContaining({ droppedQueueCount: 1 }),
      }),
    );
    expect(asyncFailures).toHaveLength(1);
    expect(asyncFailures[0]?.event).toBe('tts.queued_speak.failed');
    expect(asyncFailures[0]?.details).toEqual(
      expect.objectContaining({ droppedQueueCount: 1 }),
    );
    expect(isVoiceSessionQueuedTurnsDroppedError(asyncFailures[0]?.error)).toBe(
      true,
    );
    if (!isVoiceSessionQueuedTurnsDroppedError(asyncFailures[0]?.error)) {
      throw new Error('Expected queued-turn drop error');
    }
    expect(asyncFailures[0].error.droppedQueueCount).toBe(1);
    expect(tts.spokenTexts).toEqual(['A']);
  });

  test('destroy clears queued successors before the active turn completes', async () => {
    const { manager, speechStarts, tts, voiceStates, markDestroyed } =
      createManager();

    await manager.speakNow('A');
    manager.enqueueSpeak('B');
    markDestroyed();

    tts.settleActiveSpeak('completed');
    await flushMicrotasks();

    expect(tts.spokenTexts).toEqual(['A']);
    expect(speechStarts).toEqual(['A']);
    expect(voiceStates.at(-1)).toBe('speaking');
  });

  test('stop advances the FSM even when tts.stop throws', async () => {
    const { manager, speechStops, tts, voiceStates } = createManager();

    await manager.speakNow('A');
    tts.throwOnStop = true;

    manager.stop('processing');

    expect(speechStops).toEqual([false]);
    expect(voiceStates.at(-1)).toBe('processing');
    expect(manager.hasActiveSpeech()).toBe(false);
  });

  test('destroy unsubscribes from TTS provider events', async () => {
    const { manager, tts } = createManager();

    await manager.speakNow('A');
    expect(tts.listenerCount()).toBe(1);

    manager.destroy();

    expect(tts.listenerCount()).toBe(0);
  });

  test('surfaces connect rejection without entering speaking state', async () => {
    const { manager, tts, voiceStates } = createManager();

    tts.throwOnConnect = true;

    await expect(manager.speakNow('A')).rejects.toThrow('connect failed');
    expect(voiceStates).toEqual(['speaking', 'idle']);
    expect(manager.hasActiveSpeech()).toBe(false);
  });

  test('rejected speech completion stops the active turn', async () => {
    const { manager, speechStops, tts, voiceStates } = createManager();

    await manager.speakNow('A');
    tts.rejectActiveSpeak();
    await flushMicrotasks();

    expect(speechStops).toEqual([false]);
    expect(voiceStates.at(-1)).toBe('idle');
    expect(manager.hasActiveSpeech()).toBe(false);
  });

  test('enqueueSpeak is a no-op after destroy', async () => {
    const { manager, tts, markDestroyed } = createManager();

    markDestroyed();
    manager.enqueueSpeak('A');
    await flushMicrotasks();

    expect(tts.spokenTexts).toEqual([]);
  });
});
