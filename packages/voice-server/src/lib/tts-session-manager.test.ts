import { describe, expect, test } from 'bun:test';

import { createTTSSessionManager } from './tts-session-manager.js';
import type {
  SpeechOptions,
  SpeechSynthesisHandle,
  TTSEvent,
  TTSProvider,
  VoiceSessionState,
} from './types.js';

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
}

function createManager() {
  const tts = new MockTTSProvider();
  const voiceStates: VoiceSessionState[] = [];
  const speechStarts: string[] = [];
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
    trace() {},
    reportError() {},
    reportAsyncFailure() {},
    notifyCallbackSafely(callback, _traceEvent, ...args) {
      callback?.(...args);
    },
    emitAudioOutput() {
      return 0;
    },
    onSpeechStarted(speech) {
      speechStarts.push(speech.text);
    },
    onSpeechStopped(completed) {
      speechStops.push(completed);
    },
  });

  return {
    manager,
    markDestroyed() {
      destroyed = true;
      manager.destroy();
    },
    speechStarts,
    speechStops,
    tts,
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
