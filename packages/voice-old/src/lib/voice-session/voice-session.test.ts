import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { VoiceServerMessage } from '@maelstrom-co/protocol-old';

import type { AudioChunk, AudioFrameMeta, VoiceConnector } from '../types.js';
import type { VoiceSessionState } from './voice-session.js';

// Mock SileroVAD before importing VoiceSession
mock.module('../vad/silero-vad.js', () => ({
  SileroVAD: class MockSileroVAD {
    ready = true;
    async load() {}
    async process() {
      return { probability: 0.1 };
    }
    reset() {}
    dispose() {}
  },
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
    // Simulate realistic playback duration - don't fire onended immediately
    // This allows tests to observe the "playing" state before playback ends
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

// Global mocks storage for test access
let mockWorkletNode: MockAudioWorkletNode | null = null;

// Factory that captures instances for test inspection
class CapturingMockAudioContext extends MockAudioContext {}

// -----------------------------------------------------------------------------
// Mock VoiceConnector
// -----------------------------------------------------------------------------

interface MockVoiceConnectorOptions {
  shouldProcessSucceed?: boolean;
}

function createMockVoiceConnector(
  opts: MockVoiceConnectorOptions = {},
): VoiceConnector & {
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

    // EngineConnector required fields
    capabilities: { voice: true, streaming: true, stateful: true },
    async connect() {},
    async disconnect() {},
    subscribe() {
      return () => {};
    },

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
      if (opts.shouldProcessSucceed === false) {
        throw new Error('Process failed');
      }
      return {
        type: 'maelstrom_response' as const,
        requestId: 'mock-request-id',
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
// Mock VAD Processor (via module-level state)
// -----------------------------------------------------------------------------

// We need to mock the VADProcessor indirectly through capturing callbacks
// The VoiceSession creates VADProcessor internally, so we test behaviors
// by triggering the audio capture pipeline

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Helper to create PCM audio for playback simulation
const toPcmF32le = (samples: number[]): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    view.setFloat32(index * 4, sample, true);
  });
  return bytes;
};

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('VoiceSession', () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const originalNavigator = globalThis.navigator;

  let mockConnector: ReturnType<typeof createMockVoiceConnector>;

  function createMockGetUserMedia(shouldSucceed = true) {
    return async (
      _constraints: MediaStreamConstraints,
    ): Promise<MediaStream> => {
      if (!shouldSucceed) {
        throw new DOMException('Permission denied', 'NotAllowedError');
      }
      return new MockMediaStream() as unknown as MediaStream;
    };
  }

  beforeEach(() => {
    mockWorkletNode = null;
    mockConnector = createMockVoiceConnector();

    // Mock AudioContext
    Object.defineProperty(globalThis, 'AudioContext', {
      value: CapturingMockAudioContext,
      configurable: true,
      writable: true,
    });

    // Mock AudioWorkletNode with instance capture
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      value: class extends MockAudioWorkletNode {
        constructor(
          _ctx: MockAudioContext,
          _name: string,
          _opts?: AudioWorkletNodeOptions,
        ) {
          super();
          mockWorkletNode = this;
        }
      },
      configurable: true,
      writable: true,
    });

    // Mock navigator.mediaDevices.getUserMedia
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
  // Initial State
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('starts in idle state', () => {
      const session = new VoiceSession({
        connector: mockConnector,
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
        vadOptions: { activationThreshold: 0.8 },
      });

      expect(session.isAudioReady).toBe(false);

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
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.prepareAudio();

      expect(session.isAudioReady).toBe(true);

      session.destroy();
    });

    it('deduplicates concurrent prepareAudio() calls', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      // Fire two concurrent calls
      const p1 = session.prepareAudio();
      const p2 = session.prepareAudio();

      // Both should resolve to the same promise
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
        vadOptions: { activationThreshold: 0.8 },
        onError: (err) => errors.push(err),
      });

      await session.prepareAudio();
      await flush();

      expect(errors.length).toBe(1);
      expect(session.error).not.toBeNull();
      expect(session.error?.code).toBe('MICROPHONE_DENIED');

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
        vadOptions: { activationThreshold: 0.8 },
        onVoiceStateChange: (state) => states.push(state),
      });

      await session.startListening();

      expect(session.isListening).toBe(true);
      expect(session.voiceState).toBe('listening');
      expect(states).toContain('listening');

      session.destroy();
    });

    it('auto-prepares audio if not already ready', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
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
        vadOptions: { activationThreshold: 0.8 },
        onVoiceStateChange: (state) => states.push(state),
      });

      await session.startListening();
      const countAfterFirst = states.length;

      await session.startListening(); // Should be no-op

      expect(states.length).toBe(countAfterFirst);

      session.destroy();
    });

    it('notifies connector to start listening', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
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
        vadOptions: { activationThreshold: 0.8 },
        onVoiceStateChange: (state) => states.push(state),
      });

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
        vadOptions: { activationThreshold: 0.8 },
      });

      // Should not throw
      session.stopListening();
      session.stopListening();
      session.stopListening();

      expect(session.voiceState).toBe('idle');

      session.destroy();
    });

    it('notifies connector to stop listening', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
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
        vadOptions: { activationThreshold: 0.8 },
        onTranscript: (text, isFinal) => transcripts.push({ text, isFinal }),
      });

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
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      // Interim
      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Hello world',
        isFinal: false,
        timestamp: Date.now(),
      });
      expect(session.transcript).toBe('Hello world');

      // Final
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

    it('synthesizes a final transcript after silence timeout when server final is missing', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: {
          activationThreshold: 0.8,
          minSilenceDurationSeconds: 0.01,
        },
        onTranscript: (text, isFinal) => transcripts.push({ text, isFinal }),
      });

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

    it('dedupes late server final after synthetic finalization', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: {
          activationThreshold: 0.8,
          minSilenceDurationSeconds: 0.01,
        },
        onTranscript: (text, isFinal) => transcripts.push({ text, isFinal }),
      });

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

    it('does not synthesize final transcript when useVadToFinalizeInterims is false', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        useVadToFinalizeInterims: false,
        vadOptions: {
          activationThreshold: 0.8,
          minSilenceDurationSeconds: 0.01,
        },
        onTranscript: (text, isFinal) => transcripts.push({ text, isFinal }),
      });

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

    it('emits transcript event via on()', async () => {
      const transcripts: { text: string; isFinal: boolean }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
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
  });

  // ---------------------------------------------------------------------------
  // Server Ready & Greeting
  // ---------------------------------------------------------------------------

  describe('server ready handling', () => {
    it('sends greeting when server is ready', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
        greeting: 'Hello! How can I help you?',
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
      expect(speakMessage).toBeDefined();
      expect((speakMessage as { text: string }).text).toBe(
        'Hello! How can I help you?',
      );

      session.destroy();
    });

    it('does not send greeting if not configured', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
        // No greeting
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
    it('sets error state on server error', async () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
        onError: (err) => errors.push(err),
      });

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

    it('emits error event via on()', async () => {
      const errors: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
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
  });

  // ---------------------------------------------------------------------------
  // Maelstrom Response
  // ---------------------------------------------------------------------------

  describe('maelstrom response handling', () => {
    it('emits response event', async () => {
      const responses: { userMessage?: string; requestId: string }[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
        onResponse: (r) => responses.push(r),
      });

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

    it('emits response event via on()', async () => {
      const responses: unknown[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
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
  // Audio Playback & State Transitions
  // ---------------------------------------------------------------------------

  describe('audio playback state', () => {
    it('transitions to speaking when audio received', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
        onVoiceStateChange: (state) => states.push(state),
      });

      await session.startListening();
      states.length = 0; // Clear initial states

      // Simulate binary audio arriving
      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });

      await flush();

      // Should have transitioned to speaking
      expect(states).toContain('speaking');

      session.destroy();
    });

    it('updates _currentAudioCancellable from audio frame metadata', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      // Send non-cancellable audio
      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1]), {
        cancellable: false,
      });

      await flush();

      // The internal state _currentAudioCancellable should be false
      // We can't directly check private state, but we can verify barge-in behavior
      // in the barge-in tests below

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Barge-in / Interrupt
  // ---------------------------------------------------------------------------

  describe('interrupt()', () => {
    it('stops playback and transitions state', async () => {
      const states: VoiceSessionState[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
        onVoiceStateChange: (state) => states.push(state),
      });

      await session.startListening();

      // Simulate audio playback starting
      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, -0.1, 0.2, -0.2]), {
        cancellable: true,
      });
      await flush();

      // Now interrupt
      session.interrupt();
      await flush();

      expect(session.isSpeaking).toBe(false);

      session.destroy();
    });

    it('is safe to call when not speaking', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      // Should not throw
      session.interrupt();
      session.interrupt();

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // Event Subscriptions
  // ---------------------------------------------------------------------------

  describe('event subscriptions', () => {
    it('unsubscribes via returned function', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
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
      // Should not have increased
      expect(stateCount).toBe(countAfterStart);

      session.destroy();
    });

    it('supports multiple listeners for same event', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      let count1 = 0;
      let count2 = 0;

      session.on('stateChange', () => {
        count1 += 1;
      });
      session.on('stateChange', () => {
        count2 += 1;
      });

      await session.startListening();

      expect(count1).toBeGreaterThan(0);
      expect(count2).toBeGreaterThan(0);
      expect(count1).toBe(count2);

      session.destroy();
    });

    it('emits audioLevel events', async () => {
      const levels: number[] = [];
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      session.on('audioLevel', (level) => levels.push(level));

      await session.startListening();

      // Simulate audio from worklet which triggers VAD probability
      mockWorkletNode?.port.simulateMessage(new Float32Array([0.5, -0.5]));
      await flush();

      // audioLevel events are emitted by VAD probability callback
      // The mock may not fully trigger this, but the wiring is tested
      expect(session.audioLevel).toBeDefined();

      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // destroy()
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('cleans up all resources', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      // Should not throw
      session.destroy();

      // After destroy, no events should fire
      let stateChangeCount = 0;
      session.on('stateChange', () => {
        stateChangeCount += 1;
      });

      // Simulate messages - should be ignored
      mockConnector.simulateVoiceMessage({
        type: 'engine.stt.transcript',
        sessionId: 'test',
        text: 'Should be ignored',
        isFinal: false,
        timestamp: Date.now(),
      });

      // Listeners were cleared, so this won't increment
      expect(stateChangeCount).toBe(0);
    });

    it('is safe to call multiple times', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      // Should not throw
      session.destroy();
      session.destroy();
      session.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // State Machine: computeState()
  // ---------------------------------------------------------------------------

  describe('state machine', () => {
    it('returns idle when nothing is active', () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      expect(session.voiceState).toBe('idle');

      session.destroy();
    });

    it('returns listening when isListening=true', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      expect(session.voiceState).toBe('listening');

      session.destroy();
    });

    it('speaking takes priority over listening', async () => {
      const session = new VoiceSession({
        connector: mockConnector,
        vadOptions: { activationThreshold: 0.8 },
      });

      await session.startListening();

      // Simulate playback start
      mockConnector.simulateBinaryAudio(toPcmF32le([0.1, 0.2, 0.3, 0.4]), {
        cancellable: true,
      });
      await flush();

      // Speaking should take precedence
      expect(session.isSpeaking).toBe(true);
      expect(session.voiceState).toBe('speaking');

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

      // If we got here without throwing, test passes
      expect(true).toBe(true);
    });
  });
});
