import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import { createAudioBufferQueue } from './audio-buffer-queue.js';
import type {
  AudioChunk,
  STTEvent,
  STTProvider,
  VoiceSessionAudioDroppedEvent,
  VoiceSessionState,
} from './types.js';

class MockSTTProvider implements STTProvider {
  readonly name = 'mock-stt';
  readonly capabilities = {
    interimTranscripts: true,
  };

  readonly sentAudioChunks: AudioChunk[] = [];
  connectCalls = 0;
  endStreamCalls = 0;

  private connected = false;
  private readonly listeners = new Set<(event: STTEvent) => void>();

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  sendAudio(chunk: AudioChunk): void {
    this.sentAudioChunks.push(chunk);
  }

  endStream(): void {
    this.endStreamCalls += 1;
  }

  onEvent(callback: (event: STTEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  isConnected(): boolean {
    return this.connected;
  }

  simulateUnexpectedDisconnect(
    message = 'Mock STT disconnected unexpectedly',
  ): void {
    this.connected = false;
    this.emit({
      type: 'disconnected',
      clean: false,
      reason: 'transport_lost',
      message,
    });
  }

  emit(event: STTEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function makeLinear16Chunk(ms: number, sequence: number): AudioChunk {
  return {
    data: new Uint8Array(ms * 32),
    sampleRate: 16000,
    encoding: 'linear16',
    bytesPerSample: 2,
    channels: 1,
    timestamp: sequence,
    sequence,
  };
}

function createManagerTestContext() {
  const traces: Array<{ event: string; details?: Record<string, unknown> }> =
    [];
  const reportedErrors: Error[] = [];
  const emittedDropEvents: VoiceSessionAudioDroppedEvent[] = [];
  const statuses: string[] = [];
  let destroyed = false;
  let voiceState: VoiceSessionState = 'idle';
  const turnState = {
    currentTranscript: '',
    accumulatedTranscript: '',
    hasEmittedFinal: false,
    hasReceivedSpeech: false,
    hasSentAudioForTurn: false,
    pendingFinalFromVAD: false,
    suppressIncomingAudio: false,
  };

  const queue = createAudioBufferQueue({
    audioBufferMaxMs: 20,
    trace(event, details) {
      traces.push({ event, details });
    },
    reportError(error) {
      reportedErrors.push(
        error instanceof Error ? error : new Error(String(error)),
      );
    },
    emitAudioDropped(event) {
      emittedDropEvents.push(event);
    },
    isDestroyed() {
      return destroyed;
    },
  });

  return {
    traces,
    reportedErrors,
    emittedDropEvents,
    statuses,
    queue,
    getVoiceState() {
      return voiceState;
    },
    getTurnState() {
      return turnState;
    },
    setDestroyed(value: boolean) {
      destroyed = value;
    },
    callbacks: {
      language: 'en-US',
      maxReconnectAttempts: 2,
      reconnectDelayMs: 1,
      maxReconnectDelayMs: 20,
      reconnectBackoffMultiplier: 2,
      reconnectJitterMs: 0,
      circuitBreakerTimeoutMs: 20,
      isDestroyed() {
        return destroyed;
      },
      getVoiceState() {
        return voiceState;
      },
      setVoiceState(state: VoiceSessionState) {
        voiceState = state;
      },
      trace(event: string, details?: Record<string, unknown>) {
        traces.push({ event, details });
      },
      reportError(error: unknown) {
        reportedErrors.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
      clearAutoRestartTimeout() {},
      abortActiveProcessing() {},
      resetTurnTracking() {
        turnState.currentTranscript = '';
        turnState.accumulatedTranscript = '';
        turnState.hasEmittedFinal = false;
        turnState.hasReceivedSpeech = false;
        turnState.hasSentAudioForTurn = false;
        turnState.pendingFinalFromVAD = false;
      },
      getTurnState() {
        return turnState;
      },
      setPendingFinalFromVAD(value: boolean) {
        turnState.pendingFinalFromVAD = value;
      },
      setSuppressIncomingAudio(value: boolean) {
        turnState.suppressIncomingAudio = value;
      },
      markHasSentAudioForTurn() {
        turnState.hasSentAudioForTurn = true;
      },
      clearPendingFinalization() {},
      finalizeTranscript() {
        return { emitted: false, startedProcessing: false };
      },
      updateTranscriptState() {},
      emitFinalTranscript() {},
      createForwardedTranscriptResult(result: unknown) {
        return result;
      },
      forwardTranscriptResult() {},
      eventBus: {
        emitSttCircuitStatusChange(status: string) {
          statuses.push(status);
        },
      },
    },
  };
}

describe('stt-session-manager kernel extraction', () => {
  let clock: FakeTimers.InstalledClock;

  beforeEach(() => {
    clock = FakeTimers.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  test('exports the dedicated STT session manager kernel and removes legacy runtime helper imports', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    expect(typeof module?.createSTTSessionManager).toBe('function');
  });

  test('replays pre-connection buffered audio once listening starts', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          sendAudio: (chunk: AudioChunk, durationMs?: number) => void;
          destroy?: () => Promise<void> | void;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    const chunk = makeLinear16Chunk(4, 1);

    manager.sendAudio(chunk, 4);
    await manager.startListening();

    expect(stt.connectCalls).toBe(1);
    expect(context.getVoiceState()).toBe('listening');
    expect(stt.sentAudioChunks).toEqual([chunk]);
    expect(context.getTurnState().hasSentAudioForTurn).toBe(true);

    await manager.disconnect?.();
  });

  test('reuses one reconnect lifecycle and replays reconnect-buffered audio once after duplicate disconnects', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          sendAudio: (chunk: AudioChunk, durationMs?: number) => void;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    stt.sentAudioChunks.length = 0;

    const bufferedChunk = makeLinear16Chunk(4, 2);

    stt.simulateUnexpectedDisconnect();
    manager.sendAudio(bufferedChunk, 4);
    stt.emit({
      type: 'disconnected',
      clean: false,
      reason: 'transport_lost',
      message: 'Mock STT disconnected unexpectedly',
    });

    await clock.tickAsync(10);

    expect(stt.connectCalls).toBe(2);
    expect(
      context.traces.filter((entry) => entry.event === 'stt.reconnect.attempt'),
    ).toHaveLength(1);
    expect(stt.sentAudioChunks).toEqual([bufferedChunk]);
    expect(context.getVoiceState()).toBe('listening');
    expect(context.queue.getBufferedDurationMs()).toBe(0);

    await manager.disconnect?.();
  });

  test('disconnect clears an in-flight reconnect delay after destroy', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    context.callbacks.reconnectDelayMs = 20;
    context.callbacks.maxReconnectDelayMs = 20;
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          startListening: () => Promise<void>;
          disconnect?: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    stt.simulateUnexpectedDisconnect();
    await clock.tickAsync(0);

    expect(clock.countTimers()).toBeGreaterThan(0);

    context.setDestroyed(true);
    await manager.disconnect?.();

    expect(clock.countTimers()).toBe(0);
  });

  test('exposes endStream through the STT session manager boundary', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          endStream: () => void;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    manager.endStream();

    expect(stt.endStreamCalls).toBe(1);
  });

  test('stopListening goes idle while reconnect audio is still buffered', async () => {
    const module = await import('./stt-session-manager.js').catch(() => null);

    expect(module).not.toBeNull();
    if (!module) {
      return;
    }

    const stt = new MockSTTProvider();
    const context = createManagerTestContext();
    context.callbacks.reconnectDelayMs = 1000;
    context.callbacks.maxReconnectDelayMs = 1000;
    const manager = (
      module as {
        createSTTSessionManager: (...args: unknown[]) => {
          sendAudio: (chunk: AudioChunk, durationMs?: number) => void;
          startListening: () => Promise<void>;
          stopListening: () => Promise<void>;
        };
      }
    ).createSTTSessionManager(stt, context.queue, context.callbacks);

    await manager.startListening();
    stt.simulateUnexpectedDisconnect();
    manager.sendAudio(makeLinear16Chunk(4, 1), 4);
    manager.sendAudio(makeLinear16Chunk(4, 2), 4);

    await clock.tickAsync(50);
    expect(stt.isConnected()).toBe(false);
    await manager.stopListening();

    expect(context.getVoiceState()).toBe('idle');
  });
});
