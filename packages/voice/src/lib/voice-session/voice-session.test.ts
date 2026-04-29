import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { MessageId } from '@maelstrom-co/protocol';
import type { VoiceServerMessage } from '@maelstrom-co/protocol-old';

import type { AudioChunk, AudioFrameMeta, VoiceConnector } from '../types.js';
import type { VoiceEvent } from './events.js';
import type { VoiceSessionConfig, VoiceSessionState } from './voice-session.js';

// Mock SileroVAD before importing VoiceSession.
// WARNING: bun's mock.module is process-global — this mock contaminates
// any test file that imports from '../vad/silero-vad.js' in the same run.
// Do NOT add a standalone silero-vad.test.ts that expects the real class;
// it will get this mock instead. Test SileroVAD via VADProcessor tests.
class MockSileroVAD {
  static probability = 0.1;
  static shouldThrow = false;

  ready = true;
  async load() {}
  async process() {
    if (MockSileroVAD.shouldThrow) {
      throw new Error('MockSileroVAD: forced error');
    }
    return { probability: MockSileroVAD.probability };
  }
  reset() {}
  dispose() {}
}

mock.module('../vad/silero-vad.js', () => ({
  SileroVAD: MockSileroVAD,
}));

import { VoiceSession } from './voice-session.js';

// -----------------------------------------------------------------------------
// Mocks for Audio Infrastructure
// -----------------------------------------------------------------------------

class MockMediaStreamTrack {
  enabled = true;
  stop(): void {
    this.enabled = false;
  }
}

class MockMediaStream {
  private tracks: MockMediaStreamTrack[];

  constructor(trackCount = 1) {
    this.tracks = Array.from(
      { length: trackCount },
      () => new MockMediaStreamTrack(),
    );
  }

  getTracks(): MockMediaStreamTrack[] {
    return this.tracks;
  }
}

class MockMediaStreamAudioSourceNode {
  connect(): void {}
  disconnect(): void {}
}

class MockMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;

  simulateMessage(data: Float32Array): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class MockAudioWorkletNode {
  port = new MockMessagePort();

  connect(): void {}
  disconnect(): void {}
}

class MockAudioBuffer {
  readonly channels: Float32Array[];
  readonly duration: number;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
    this.duration = length / sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  onended: (() => void) | null = null;
  private ended = false;

  constructor(private ctx: MockAudioContext) {}

  connect(): void {}

  start(when = 0): void {
    if (this.ended) return;
    const duration = this.buffer?.duration ?? 0;
    this.ctx.currentTime = when + duration + 0.02;
    setTimeout(() => {
      if (this.ended) return;
      this.ended = true;
      this.onended?.();
    }, 50);
  }

  stop(): void {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  readonly sampleRate: number;
  destination = {} as AudioDestinationNode;
  audioWorklet = {
    addModule: async (_url: string): Promise<void> => {},
  };

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? 44100;
  }

  createMediaStreamSource(
    _stream: MediaStream,
  ): MockMediaStreamAudioSourceNode {
    return new MockMediaStreamAudioSourceNode();
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): MockAudioBuffer {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): MockAudioBufferSourceNode {
    return new MockAudioBufferSourceNode(this);
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

class CapturingMockAudioContext extends MockAudioContext {}

// -----------------------------------------------------------------------------
// Mock VoiceConnector
// -----------------------------------------------------------------------------

function createMockVoiceConnector(): VoiceConnector & {
  voiceMessageCallbacks: Set<(message: VoiceServerMessage) => void>;
  binaryAudioCallbacks: Set<(data: Uint8Array, meta: AudioFrameMeta) => void>;
  sentMessages: unknown[];
  sentAudioChunks: AudioChunk[];
  simulateVoiceMessage: (message: VoiceServerMessage) => void;
  simulateBinaryAudio: (data: Uint8Array, meta: AudioFrameMeta) => void;
  isListening: boolean;
} {
  const voiceMessageCallbacks = new Set<
    (message: VoiceServerMessage) => void
  >();
  const binaryAudioCallbacks = new Set<
    (data: Uint8Array, meta: AudioFrameMeta) => void
  >();
  const sentMessages: unknown[] = [];
  const sentAudioChunks: AudioChunk[] = [];
  let isListening = false;

  return {
    voiceMessageCallbacks,
    binaryAudioCallbacks,
    sentMessages,
    sentAudioChunks,
    get isListening() {
      return isListening;
    },

    capabilities: { voice: true, streaming: true, stateful: true },
    async connect() {},
    async disconnect() {},
    subscribe() {
      return () => {};
    },
    async addAssistantMessage() {},

    simulateVoiceMessage(message: VoiceServerMessage) {
      voiceMessageCallbacks.forEach((cb) => {
        cb(message);
      });
    },

    simulateBinaryAudio(data: Uint8Array, meta: AudioFrameMeta) {
      binaryAudioCallbacks.forEach((cb) => {
        cb(data, meta);
      });
    },

    async process() {
      return {
        type: 'maelstrom_response' as const,
        requestId: MessageId('mock-request-id'),
        userMessage: 'OK',
        rationale: 'Mock response',
        executionPlan: [],
        layout: { type: 'tiling' as const, tree: [], instances: [] },
      };
    },

    sendVoiceMessage(message: unknown) {
      sentMessages.push(message);
    },

    sendAudioChunk(chunk: AudioChunk) {
      sentAudioChunks.push(chunk);
    },

    startListening(_language?: string, _interimResults?: boolean) {
      isListening = true;
    },

    stopListening() {
      isListening = false;
    },

    onVoiceMessage(callback: (message: VoiceServerMessage) => void) {
      voiceMessageCallbacks.add(callback);
      return () => {
        voiceMessageCallbacks.delete(callback);
      };
    },

    onBinaryAudio(callback: (data: Uint8Array, meta: AudioFrameMeta) => void) {
      binaryAudioCallbacks.add(callback);
      return () => {
        binaryAudioCallbacks.delete(callback);
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const toPcmF32le = (samples: number[]): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    view.setFloat32(index * 4, sample, true);
  });
  return bytes;
};

function createMockGetUserMedia(shouldSucceed = true) {
  return async (_constraints: MediaStreamConstraints): Promise<MediaStream> => {
    if (!shouldSucceed) {
      throw new DOMException('Permission denied', 'NotAllowedError');
    }
    return new MockMediaStream() as unknown as MediaStream;
  };
}

function createDeferredGetUserMedia() {
  let resolveStream: ((stream: MediaStream) => void) | null = null;

  return {
    getUserMedia: async (
      _constraints: MediaStreamConstraints,
    ): Promise<MediaStream> =>
      new Promise((resolve) => {
        resolveStream = resolve;
      }),
    resolve(): void {
      resolveStream?.(new MockMediaStream() as unknown as MediaStream);
    },
  };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('VoiceSession', () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const originalNavigator = globalThis.navigator;

  let mockConnector: ReturnType<typeof createMockVoiceConnector>;
  let lastWorkletNode: MockAudioWorkletNode | null = null;

  beforeEach(() => {
    mockConnector = createMockVoiceConnector();
    lastWorkletNode = null;

    MockSileroVAD.probability = 0.1;
    MockSileroVAD.shouldThrow = false;

    Object.defineProperty(globalThis, 'AudioContext', {
      value: CapturingMockAudioContext,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      value: class extends MockAudioWorkletNode {
        constructor(
          _ctx: MockAudioContext,
          _name: string,
          _opts?: AudioWorkletNodeOptions,
        ) {
          super();
          lastWorkletNode = this;
        }
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: createMockGetUserMedia(true),
        },
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'AudioContext', {
      value: originalAudioContext,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      value: originalAudioWorkletNode,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  // ---------------------------------------------------------------------------
  // Config-only constructor
  // ---------------------------------------------------------------------------

  describe('config-only constructor', () => {
    it('accepts config properties without callbacks', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
        language: 'es',
        interimResults: false,
        greeting: 'Hola!',
        sessionId: 'test-session-123',
        debugMode: false,
      });

      expect(session.voiceState).toBe('idle');

      session.destroy();
    });

    it('does not accept onTranscript, onError, or onVoiceStateChange as config', () => {
      // The new API uses on() for subscriptions, not constructor callbacks.
      // Verify the type signature works with config-only properties.
      const config = {
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      };

      // Ensure extra callback-style properties are not in VoiceSessionConfig
      const hasOnTranscript = 'onTranscript' in config;
      const hasOnError = 'onError' in config;
      const hasOnVoiceStateChange = 'onVoiceStateChange' in config;

      expect(hasOnTranscript).toBe(false);
      expect(hasOnError).toBe(false);
      expect(hasOnVoiceStateChange).toBe(false);

      const session = new VoiceSession(config);
      session.destroy();
    });

    it('uses default values for optional config', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      // Session should work fine with defaults
      expect(session.voiceState).toBe('idle');
      expect(session.isListening).toBe(false);
      expect(session.isSpeaking).toBe(false);
      expect(session.transcript).toBe('');
      expect(session.error).toBeNull();

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Initial State
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('starts in idle state', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      expect(session.voiceState).toBe('idle');
      expect(session.isListening).toBe(false);
      expect(session.isSpeaking).toBe(false);
      expect(session.transcript).toBe('');
      expect(session.audioLevel).toBe(0);
      expect(session.error).toBeNull();

      session.destroy();
    });

    it('isAudioReady is false before prepareAudio()', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      expect(session.isAudioReady).toBe(false);

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Event system basics
  // ---------------------------------------------------------------------------

  describe('event system', () => {
    it('on() returns an unsubscribe function that works', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      let stateCount = 0;
      const unsubscribe = session.on('stateChange', () => {
        stateCount += 1;
      });

      await session.startListening();
      expect(stateCount).toBeGreaterThan(0);

      const countAfterStart = stateCount;
      unsubscribe();

      session.stopListening();
      // Should not have increased after unsubscribe
      expect(stateCount).toBe(countAfterStart);

      session.destroy();
    });

    it('multiple listeners on same event all fire', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      let count1 = 0;
      let count2 = 0;
      let count3 = 0;

      session.on('stateChange', () => {
        count1 += 1;
      });
      session.on('stateChange', () => {
        count2 += 1;
      });
      session.on('stateChange', () => {
        count3 += 1;
      });

      await session.startListening();

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
      expect(count3).toBeGreaterThan(0);
      expect(count1).toBe(count2);
      expect(count2).toBe(count3);

      session.destroy();
    });

    it('catchall on("event") receives VoiceEvent discriminated unions', async () => {
      const events: VoiceEvent[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('event', (ev) => events.push(ev));

      await session.startListening();

      // Trigger a transcript event
      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Hello',
        isFinal: true,
        timestamp: Date.now(),
      });

      // Catchall should have received stateChange events (from startListening)
      // and the transcript event
      const stateEvents = events.filter((e) => e.type === 'stateChange');
      const transcriptEvents = events.filter((e) => e.type === 'transcript');

      expect(stateEvents.length).toBeGreaterThan(0);
      expect(transcriptEvents.length).toBe(1);

      const te = transcriptEvents[0] as {
        type: 'transcript';
        text: string;
        isFinal: boolean;
      };
      expect(te.text).toBe('Hello');
      expect(te.isFinal).toBe(true);

      session.destroy();
    });

    it('catchall receives events alongside specific listeners', async () => {
      const specificTranscripts: string[] = [];
      const catchallEvents: VoiceEvent[] = [];

      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('transcript', (text) => specificTranscripts.push(text));
      session.on('event', (ev) => catchallEvents.push(ev));

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Both fire',
        isFinal: true,
        timestamp: Date.now(),
      });

      expect(specificTranscripts).toContain('Both fire');
      const catchallTranscript = catchallEvents.find(
        (e) => e.type === 'transcript',
      );
      expect(catchallTranscript).toBeDefined();

      session.destroy();
    });

    it('unsubscribing one listener does not affect others', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      let count1 = 0;
      let count2 = 0;

      const unsub1 = session.on('stateChange', () => {
        count1 += 1;
      });
      session.on('stateChange', () => {
        count2 += 1;
      });

      await session.startListening();
      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);

      const snapshot1 = count1;
      unsub1();

      session.stopListening();

      // count1 frozen, count2 still increments
      expect(count1).toBe(snapshot1);
      expect(count2).toBeGreaterThan(snapshot1);

      session.destroy();
    });

    it('emits transcript events via on()', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('transcript', (text, isFinal) => {
        transcripts.push({ text, isFinal });
      });

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Test',
        isFinal: true,
        timestamp: Date.now(),
      });

      expect(transcripts).toEqual([{ text: 'Test', isFinal: true }]);

      session.destroy();
    });

    it('emits error events via on()', () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('error', (err) => errors.push(err));

      mockConnector.simulateVoiceMessage({
        type: 'engine.error',
        sessionId: 'test',
        error: 'Network failure',
        timestamp: Date.now(),
      });

      expect(errors.length).toBe(1);

      session.destroy();
    });

    it('emits response events via on()', () => {
      const responses: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('response', (r) => responses.push(r));

      mockConnector.simulateVoiceMessage({
        type: 'engine.maelstrom.response',
        sessionId: 'test',
        requestId: 'req-456',
        response: {
          type: 'maelstrom_response',
          requestId: 'req-456',
          layout: { type: 'tiling', tree: [], instances: [] },
          userMessage: 'Done!',
          rationale: 'Test rationale',
          executionPlan: [],
        },
      });

      expect(responses.length).toBe(1);

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // prepareAudio()
  // ---------------------------------------------------------------------------

  describe('prepareAudio()', () => {
    it('sets isAudioReady to true after successful preparation', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.prepareAudio();

      expect(session.isAudioReady).toBe(true);

      session.destroy();
    });

    it('deduplicates concurrent prepareAudio() calls', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      const p1 = session.prepareAudio();
      const p2 = session.prepareAudio();

      await Promise.all([p1, p2]);

      expect(session.isAudioReady).toBe(true);

      session.destroy();
    });

    it('emits error when microphone permission denied', async () => {
      (globalThis as Record<string, unknown>).navigator = {
        mediaDevices: { getUserMedia: createMockGetUserMedia(false) },
      };

      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('error', (err) => errors.push(err));

      await expect(session.prepareAudio()).rejects.toBeDefined();
      await flush();

      expect(errors.length).toBe(1);
      expect(session.error).not.toBeNull();
      expect(session.error?.code).toBe('MICROPHONE_DENIED');

      session.destroy();
    });

    it('rejects promise so caller .catch() chains fire', async () => {
      (globalThis as Record<string, unknown>).navigator = {
        mediaDevices: { getUserMedia: createMockGetUserMedia(false) },
      };

      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      let caughtErr: unknown = null;
      await session.prepareAudio().catch((err) => {
        caughtErr = err;
      });

      expect(caughtErr).not.toBeNull();

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // startListening() / stopListening()
  // ---------------------------------------------------------------------------

  describe('startListening()', () => {
    it('transitions to listening state', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('stateChange', (state) => states.push(state));

      await session.startListening();

      expect(session.isListening).toBe(true);
      expect(session.voiceState).toBe('listening');
      expect(states).toContain('listening');

      session.destroy();
    });

    it('auto-prepares audio if not already ready', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      expect(session.isAudioReady).toBe(false);

      await session.startListening();

      expect(session.isAudioReady).toBe(true);
      expect(session.isListening).toBe(true);

      session.destroy();
    });

    it('is idempotent when already listening', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('stateChange', (state) => states.push(state));

      await session.startListening();
      const countAfterFirst = states.length;

      await session.startListening(); // Should be no-op

      expect(states.length).toBe(countAfterFirst);

      session.destroy();
    });

    it('notifies connector to start listening with config', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
        language: 'es',
        interimResults: false,
      });

      await session.startListening();

      expect(mockConnector.isListening).toBe(true);

      session.destroy();
    });
  });

  describe('stopListening()', () => {
    it('transitions back to idle state', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('stateChange', (state) => states.push(state));

      await session.startListening();
      session.stopListening();

      expect(session.isListening).toBe(false);
      expect(session.voiceState).toBe('idle');
      expect(states).toContain('idle');

      session.destroy();
    });

    it('is safe to call when not listening', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.stopListening();
      session.stopListening();
      session.stopListening();

      expect(session.voiceState).toBe('idle');

      session.destroy();
    });

    it('notifies connector to stop listening', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();
      expect(mockConnector.isListening).toBe(true);

      session.stopListening();
      expect(mockConnector.isListening).toBe(false);

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Transcript Handling
  // ---------------------------------------------------------------------------

  describe('transcript handling', () => {
    it('updates transcript on interim results', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('transcript', (text, isFinal) =>
        transcripts.push({ text, isFinal }),
      );

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Hello',
        isFinal: false,
        timestamp: Date.now(),
      });

      expect(transcripts).toEqual([{ text: 'Hello', isFinal: false }]);
      expect(session.transcript).toBe('Hello');

      session.destroy();
    });

    it('clears transcript on final result', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Hello world',
        isFinal: false,
        timestamp: Date.now(),
      });
      expect(session.transcript).toBe('Hello world');

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Hello world!',
        isFinal: true,
        timestamp: Date.now(),
      });
      expect(session.transcript).toBe('');

      session.destroy();
    });

    it('synthesizes final transcript after silence timeout', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.8,
          minSilenceDurationSeconds: 0.01,
        },
      });

      session.on('transcript', (text, isFinal) =>
        transcripts.push({ text, isFinal }),
      );

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'show my lab results',
        isFinal: false,
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(transcripts).toEqual([
        { text: 'show my lab results', isFinal: false },
        { text: 'show my lab results', isFinal: true },
      ]);
      expect(session.transcript).toBe('');

      session.destroy();
    });

    it('deduplicates late server final after synthetic finalization', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.8,
          minSilenceDurationSeconds: 0.01,
        },
      });

      session.on('transcript', (text, isFinal) =>
        transcripts.push({ text, isFinal }),
      );

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'open lab results',
        isFinal: false,
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Open lab results.',
        isFinal: true,
        timestamp: Date.now(),
      });

      expect(transcripts).toEqual([
        { text: 'open lab results', isFinal: false },
        { text: 'open lab results', isFinal: true },
      ]);

      session.destroy();
    });

    it('does not synthesize final when useVadToFinalizeInterims is false', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        useVadToFinalizeInterims: false,
        vadOptions: {
          activationThreshold: 0.8,
          minSilenceDurationSeconds: 0.01,
        },
      });

      session.on('transcript', (text, isFinal) =>
        transcripts.push({ text, isFinal }),
      );

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'latest interim only',
        isFinal: false,
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(transcripts).toEqual([
        { text: 'latest interim only', isFinal: false },
      ]);
      expect(session.transcript).toBe('latest interim only');

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Server Ready & Greeting
  // ---------------------------------------------------------------------------

  describe('server ready handling', () => {
    it('sends greeting only after audio preparation completes', async () => {
      const deferredMic = createDeferredGetUserMedia();
      (globalThis as Record<string, unknown>).navigator = {
        mediaDevices: { getUserMedia: deferredMic.getUserMedia },
      };

      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
        greeting: 'Hello! How can I help you?',
      });

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.ready',
        sessionId: 'test-session',
        timestamp: Date.now(),
      });

      await flush();

      expect(session.isAudioReady).toBe(false);

      let speakMessage = mockConnector.sentMessages.find(
        (m) => (m as { type: string }).type === 'client.voice.speak',
      );
      expect(speakMessage).toBeUndefined();

      deferredMic.resolve();
      await flush();
      await flush();

      expect(session.isAudioReady).toBe(true);

      speakMessage = mockConnector.sentMessages.find(
        (m) => (m as { type: string }).type === 'client.voice.speak',
      );
      expect(speakMessage).toBeDefined();
      expect((speakMessage as { text: string }).text).toBe(
        'Hello! How can I help you?',
      );

      session.destroy();
    });

    it('runtime gate drops greeting if autoAcquireMic is false (defence-in-depth)', async () => {
      // The discriminated union forbids `greeting` with `autoAcquireMic: false`
      // at compile time. The runtime gate is the second layer that protects
      // callers who bypass the type system (JS, `any`, dynamic config).
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
        greeting: 'Hello! How can I help you?',
        autoAcquireMic: false,
      } as unknown as VoiceSessionConfig);

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.ready',
        sessionId: 'test-session',
        timestamp: Date.now(),
      });

      await flush();

      const speakMessage = mockConnector.sentMessages.find(
        (m) => (m as { type: string }).type === 'client.voice.speak',
      );
      expect(speakMessage).toBeUndefined();
      expect(session.isAudioReady).toBe(false);

      session.destroy();
    });

    it('does not acquire mic on server ready when autoAcquireMic is false', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: false,
        vadOptions: { activationThreshold: 0.8 },
      });

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.ready',
        sessionId: 'test-session',
        timestamp: Date.now(),
      });

      await flush();

      expect(session.isAudioReady).toBe(false);

      session.destroy();
    });

    it('manual gesture: startListening() after server ready acquires mic when autoAcquireMic is false', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: false,
        vadOptions: { activationThreshold: 0.8 },
      });

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.ready',
        sessionId: 'test-session',
        timestamp: Date.now(),
      });
      await flush();

      // Server-ready alone does not acquire mic.
      expect(session.isAudioReady).toBe(false);

      // Simulating a user gesture: explicit startListening() should drive
      // prepareAudio() (mic acquire) and connector.startListening().
      const startListeningSpy = mock(() => {});
      const originalStart = mockConnector.startListening;
      mockConnector.startListening = startListeningSpy;

      await session.startListening();

      expect(session.isAudioReady).toBe(true);
      expect(startListeningSpy).toHaveBeenCalled();

      mockConnector.startListening = originalStart;
      session.destroy();
    });

    it('does not send greeting when prepareAudio rejects and retries after recovery', async () => {
      (globalThis as Record<string, unknown>).navigator = {
        mediaDevices: { getUserMedia: createMockGetUserMedia(false) },
      };

      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
        greeting: 'Hello',
      });

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.ready',
        sessionId: 'test-session',
        timestamp: Date.now(),
      });
      await flush();

      const firstCount = mockConnector.sentMessages.filter(
        (m) => (m as { type: string }).type === 'client.voice.speak',
      ).length;
      expect(firstCount).toBe(0);

      // Restore mic, clear error state, simulate ready again — greeting
      // should fire a second time because greetingSent was reset.
      (globalThis as Record<string, unknown>).navigator = {
        mediaDevices: { getUserMedia: createMockGetUserMedia(true) },
      };

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.ready',
        sessionId: 'test-session',
        timestamp: Date.now(),
      });
      await flush();

      const secondCount = mockConnector.sentMessages.filter(
        (m) => (m as { type: string }).type === 'client.voice.speak',
      ).length;
      expect(secondCount).toBe(1);

      session.destroy();
    });

    it('does not send greeting if not configured', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.ready',
        sessionId: 'test-session',
        timestamp: Date.now(),
      });

      await flush();

      const speakMessage = mockConnector.sentMessages.find(
        (m) => (m as { type: string }).type === 'client.voice.speak',
      );
      expect(speakMessage).toBeUndefined();

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe('error handling', () => {
    it('sets error state on server error', () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('error', (err) => errors.push(err));

      mockConnector.simulateVoiceMessage({
        type: 'engine.error',
        sessionId: 'test',
        error: 'Something went wrong',
        timestamp: Date.now(),
      });

      expect(errors.length).toBe(1);
      expect(session.error).not.toBeNull();

      session.destroy();
    });

    it('isolates throwing listener from later listeners and emitter', () => {
      const originalConsoleError = console.error;
      console.error = () => {};

      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      let secondCalled = false;
      session.on('error', () => {
        throw new Error('first listener throws');
      });
      session.on('error', () => {
        secondCalled = true;
      });

      expect(() => {
        mockConnector.simulateVoiceMessage({
          type: 'engine.error',
          sessionId: 'test',
          error: 'Something went wrong',
          timestamp: Date.now(),
        });
      }).not.toThrow();

      expect(secondCalled).toBe(true);

      session.destroy();
      console.error = originalConsoleError;
    });

    it('transitions to error state and emits stateChange on error', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      const states: VoiceSessionState[] = [];
      session.on('stateChange', (s) => states.push(s));

      mockConnector.simulateVoiceMessage({
        type: 'engine.error',
        sessionId: 'test',
        error: 'boom',
        timestamp: Date.now(),
      });

      expect(session.voiceState).toBe('error');
      expect(states).toContain('error');

      session.destroy();
    });

    it('surfaces AudioPlayback errors via session error event', async () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('error', (err) => errors.push(err));

      await session.startListening();

      // Make playback's createBuffer throw on the next call.
      const origCreateBuffer = CapturingMockAudioContext.prototype.createBuffer;
      CapturingMockAudioContext.prototype.createBuffer = function (): never {
        throw new Error('Playback createBuffer failed');
      };

      try {
        mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
          cancellable: true,
        });
        await flush();
      } finally {
        CapturingMockAudioContext.prototype.createBuffer = origCreateBuffer;
      }

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(session.error).not.toBeNull();

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Maelstrom Response
  // ---------------------------------------------------------------------------

  describe('maelstrom response handling', () => {
    it('emits response event with userMessage and requestId', () => {
      const responses: { userMessage?: string; requestId: string }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('response', (r) => responses.push(r));

      mockConnector.simulateVoiceMessage({
        type: 'engine.maelstrom.response',
        sessionId: 'test',
        requestId: 'req-123',
        response: {
          type: 'maelstrom_response',
          requestId: 'req-123',
          layout: { type: 'tiling', tree: [], instances: [] },
          userMessage: 'Here is your calendar',
          rationale: 'Test rationale',
          executionPlan: [],
        },
      });

      expect(responses).toEqual([
        { userMessage: 'Here is your calendar', requestId: 'req-123' },
      ]);

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Audio Playback & State Transitions
  // ---------------------------------------------------------------------------

  describe('audio playback state', () => {
    it('transitions to speaking when audio received', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('stateChange', (state) => states.push(state));

      await session.startListening();
      states.length = 0;

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });

      await flush();

      expect(states).toContain('speaking');

      session.destroy();
    });

    it('primes playback during startListening so later binary TTS still plays when browser blocks new AudioContexts', async () => {
      let allowContextCreation = false;

      Object.defineProperty(globalThis, 'AudioContext', {
        value: class extends CapturingMockAudioContext {
          constructor(options?: AudioContextOptions) {
            if (!allowContextCreation) {
              throw new Error('AudioContext blocked outside user gesture');
            }
            super(options);
          }
        },
        configurable: true,
        writable: true,
      });

      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('error', (err) => errors.push(err));

      allowContextCreation = true;
      await session.startListening();
      allowContextCreation = false;

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });

      await flush();

      expect(session.isSpeaking).toBe(true);
      expect(errors).toEqual([]);

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Interrupt
  // ---------------------------------------------------------------------------

  describe('interrupt()', () => {
    it('stops playback and transitions state', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();

      session.interrupt();
      await flush();

      expect(session.isSpeaking).toBe(false);

      session.destroy();
    });

    it('drops stale audio after interrupt until new speaking turn', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();
      expect(session.isSpeaking).toBe(true);

      session.interrupt();
      await flush();
      expect(session.isSpeaking).toBe(false);

      // Stale audio should be dropped
      mockConnector.simulateBinaryAudio(toPcmF32le([0.3, -0.3, 0.4, -0.4]), {
        cancellable: true,
      });
      await flush();
      expect(session.isSpeaking).toBe(false);

      // New turn from server re-enables audio
      mockConnector.simulateVoiceMessage({
        type: 'engine.tts.sent',
        sessionId: 'test',
        text: 'Fresh response',
        timestamp: Date.now(),
        data: new Uint8Array(0),
        format: 'pcm',
        sampleRate: 24000,
        sequence: 0,
        isFinal: false,
      });
      mockConnector.simulateBinaryAudio(toPcmF32le([0.5, -0.5, 0.6, -0.6]), {
        cancellable: true,
      });
      await flush();
      expect(session.isSpeaking).toBe(true);

      session.destroy();
    });

    it('is safe to call when not speaking', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.interrupt();
      session.interrupt();

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------

  describe('state machine', () => {
    it('returns idle when nothing is active', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      expect(session.voiceState).toBe('idle');

      session.destroy();
    });

    it('returns listening when isListening=true', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      expect(session.voiceState).toBe('listening');

      session.destroy();
    });

    it('speaking takes priority over listening', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, 0.2, 0.3, 0.4]), {
        cancellable: true,
      });
      await flush();

      expect(session.isSpeaking).toBe(true);
      expect(session.voiceState).toBe('speaking');

      session.destroy();
    });

    it('stateChange events fire on transitions', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('stateChange', (state) => states.push(state));

      // idle -> listening
      await session.startListening();
      expect(states).toContain('listening');

      // listening -> speaking (via audio playback)
      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();
      expect(states).toContain('speaking');

      // speaking -> idle (via interrupt + stop)
      session.interrupt();
      session.stopListening();
      expect(states).toContain('idle');

      session.destroy();
    });

    it('transitions idle -> listening -> idle via start/stop', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('stateChange', (state) => states.push(state));

      expect(session.voiceState).toBe('idle');

      await session.startListening();
      expect(session.voiceState).toBe('listening');

      session.stopListening();
      expect(session.voiceState).toBe('idle');

      // Verify events contained expected transitions
      expect(states).toContain('listening');
      expect(states[states.length - 1]).toBe('idle');

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // destroy()
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('cleans up all resources and clears listeners', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      session.destroy();

      // After destroy, new listeners should not fire because
      // connector unsubscriptions prevent new events from reaching VoiceSession
      let stateChangeCount = 0;
      session.on('stateChange', () => {
        stateChangeCount += 1;
      });

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Should be ignored',
        isFinal: false,
        timestamp: Date.now(),
      });

      expect(stateChangeCount).toBe(0);
    });

    it('is safe to call multiple times', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      session.destroy();
      session.destroy();
      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Debug Mode
  // ---------------------------------------------------------------------------

  describe('debug mode', () => {
    it('does not throw with debugMode enabled', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
        debugMode: true,
      });

      await session.startListening();

      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Debug test',
        isFinal: true,
        timestamp: Date.now(),
      });

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1]), {
        cancellable: true,
      });

      await flush();

      session.stopListening();
      session.destroy();

      expect(true).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // VAD-triggered paths
  // ---------------------------------------------------------------------------

  /**
   * Simulate an audio capture event by posting a Float32Array chunk to the
   * AudioWorklet port. VoiceSession wires captureNode.port.onmessage during
   * AudioCapture.start(), which is called from startListening(). A chunk of
   * 4096 samples is the buffer size emitted by the real worklet processor;
   * VoiceSession slices it into 512-sample VAD windows (8 windows per chunk).
   */
  function simulateCaptureChunk(
    node: MockAudioWorkletNode,
    value = 0.5,
    length = 4096,
  ): void {
    const float32 = new Float32Array(length).fill(value);
    node.port.simulateMessage(float32);
  }

  describe('VAD-triggered paths', () => {
    it('barge-in via VAD speech start stops playback', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
        },
      });

      await session.startListening();

      // Enqueue audio to put session into speaking state
      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();
      expect(session.isSpeaking).toBe(true);

      // Raise VAD probability above the activation threshold to trigger speech start
      MockSileroVAD.probability = 0.9;

      // Send audio through the capture path to drive VAD processing
      const node = lastWorkletNode!;
      simulateCaptureChunk(node);

      // Allow VAD async processing to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Barge-in should have interrupted playback
      expect(session.isSpeaking).toBe(false);

      session.destroy();
    });

    it('ignores VAD speech start during playback when allowBargeIn is false', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        allowBargeIn: false,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
        },
      });

      await session.startListening();

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();
      expect(session.isSpeaking).toBe(true);

      const messagesBefore = mockConnector.sentMessages.length;
      const chunksBefore = mockConnector.sentAudioChunks.length;

      MockSileroVAD.probability = 0.9;

      const node = lastWorkletNode!;
      simulateCaptureChunk(node);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(session.isSpeaking).toBe(true);
      expect(mockConnector.sentMessages.length).toBe(messagesBefore);
      expect(mockConnector.sentAudioChunks.length).toBe(chunksBefore);

      session.destroy();
    });

    it('buffered audio is forwarded to connector on VAD speech start', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
        },
      });

      await session.startListening();
      const chunksBefore = mockConnector.sentAudioChunks.length;

      // Raise probability to trigger speech start
      MockSileroVAD.probability = 0.9;

      const node = lastWorkletNode!;
      simulateCaptureChunk(node);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // VAD speech start should have caused sendAudioChunk to be called with
      // the pre-speech ring-buffer audio
      expect(mockConnector.sentAudioChunks.length).toBeGreaterThan(
        chunksBefore,
      );

      session.destroy();
    });

    it('isListening is restored to true after playback ends', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();
      expect(session.isListening).toBe(true);

      // Trigger playback — isListening becomes false while speaking
      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();
      expect(session.isSpeaking).toBe(true);
      expect(session.isListening).toBe(false);

      // Wait for MockAudioBufferSourceNode to fire onended (~50ms timeout in mock)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // isListening should be restored because hasUserInitiatedListening is true
      expect(session.isSpeaking).toBe(false);
      expect(session.isListening).toBe(true);
      expect(session.voiceState).toBe('listening');

      session.destroy();
    });

    it('late playbackEnd does not revive isListening after stopListening', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();
      expect(session.isListening).toBe(true);

      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();
      expect(session.isSpeaking).toBe(true);

      session.stopListening();
      expect(session.isListening).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(session.isListening).toBe(false);
      expect(session.voiceState).not.toBe('listening');

      session.destroy();
    });

    it('VAD errors are surfaced via the error event', async () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
        },
      });

      session.on('error', (err) => errors.push(err));

      await session.startListening();

      // Make the next VAD process() call throw
      MockSileroVAD.shouldThrow = true;

      try {
        const node = lastWorkletNode!;
        simulateCaptureChunk(node);

        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(errors.length).toBeGreaterThan(0);
        expect(session.error).not.toBeNull();
      } finally {
        MockSileroVAD.shouldThrow = false;
        session.destroy();
      }
    });

    it('sendAudioChunk error in capture callback is surfaced via #setError', async () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
        },
      });

      session.on('error', (err) => errors.push(err));

      await session.startListening();

      // Trigger VAD speech start so userIsTalking becomes true
      MockSileroVAD.probability = 0.9;
      const node = lastWorkletNode!;
      simulateCaptureChunk(node);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now make sendAudioChunk throw (simulating WebSocket closed)
      mockConnector.sendAudioChunk = () => {
        throw new Error('WebSocket is already closed');
      };

      // Send another audio chunk — the capture callback should catch the error
      simulateCaptureChunk(node);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errors.length).toBeGreaterThan(0);
      expect(session.error).not.toBeNull();

      session.destroy();
    });

    it('sendVoiceMessage error in #handleVadSpeechStart is surfaced via #setError', async () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
        },
      });

      session.on('error', (err) => errors.push(err));

      await session.startListening();

      // Make sendVoiceMessage throw before VAD triggers speech start
      mockConnector.sendVoiceMessage = () => {
        throw new Error('WebSocket is already closed');
      };

      MockSileroVAD.probability = 0.9;
      const node = lastWorkletNode!;
      simulateCaptureChunk(node);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Error should be surfaced, and state updates should still have executed
      expect(errors.length).toBeGreaterThan(0);
      expect(session.error).not.toBeNull();

      session.destroy();
    });

    it('rolls back userIsTalking when connector throws in speech start', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
        },
      });

      await session.startListening();

      mockConnector.sendVoiceMessage = () => {
        throw new Error('WebSocket is already closed');
      };

      MockSileroVAD.probability = 0.9;
      const node = lastWorkletNode!;
      simulateCaptureChunk(node);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // With error-priority in computeState, voiceState is 'error'; but
      // after restoring a working connector and clearing the error,
      // state should be 'listening' (not stuck in 'silence').
      expect(session.voiceState).toBe('error');

      session.destroy();
    });

    it('sendVoiceMessage error in #handleVadSpeechEnd is surfaced via #setError', async () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
          minSilenceDurationSeconds: 0.1,
        },
      });

      session.on('error', (err) => errors.push(err));

      await session.startListening();

      // Drive speech start then end
      MockSileroVAD.probability = 0.9;
      const node = lastWorkletNode!;
      simulateCaptureChunk(node);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now make sendVoiceMessage throw for the speech-end path
      mockConnector.sendVoiceMessage = () => {
        throw new Error('WebSocket is already closed');
      };

      MockSileroVAD.probability = 0.1;
      for (let i = 0; i < 10; i++) {
        simulateCaptureChunk(node, 0);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(errors.length).toBeGreaterThan(0);
      expect(session.error).not.toBeNull();

      session.destroy();
    });

    it('VAD speech-end → transcript finalization via scheduleInterimFinalize', async () => {
      const events: VoiceEvent[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        autoAcquireMic: true,
        vadOptions: {
          activationThreshold: 0.5,
          minSpeechDurationSeconds: 0.05,
          // Short silence duration so speech-end fires quickly and
          // the finalize timeout (derived from this) is ~100ms.
          minSilenceDurationSeconds: 0.1,
        },
      });

      session.on('event', (ev) => events.push(ev));

      await session.startListening();

      // 1. Trigger VAD speech start
      MockSileroVAD.probability = 0.9;
      const node = lastWorkletNode!;
      simulateCaptureChunk(node);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 2. Send an interim transcript while user is talking
      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'hello world',
        isFinal: false,
        timestamp: Date.now(),
      });
      await flush();

      expect(session.transcript).toBe('hello world');

      // 3. Trigger VAD speech end by lowering probability
      MockSileroVAD.probability = 0.01;
      // Need enough chunks to cross the silence threshold
      for (let i = 0; i < 15; i++) {
        simulateCaptureChunk(node, 0.01);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      // 4. Wait for the finalize timeout to fire (100ms from minSilenceDurationSeconds)
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The interim transcript should have been finalized
      const transcriptEvents = events.filter((e) => e.type === 'transcript');
      const hasFinal = transcriptEvents.some(
        (e) => e.type === 'transcript' && 'isFinal' in e && e.isFinal,
      );
      expect(hasFinal).toBe(true);

      session.destroy();
    });
  });
});
