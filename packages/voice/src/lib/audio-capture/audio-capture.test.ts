import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { AudioCapture } from './audio-capture.js';

// -----------------------------------------------------------------------------
// Mocks for Web Audio API and getUserMedia
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

class MockAudioContext {
  state: AudioContextState = 'running';
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

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

// Global mocks storage for test access
let mockAudioContext: MockAudioContext | null = null;
let mockWorkletNode: MockAudioWorkletNode | null = null;

// Factory that captures instances for test inspection
class CapturingMockAudioContext extends MockAudioContext {
  constructor(options?: AudioContextOptions) {
    super(options);
    mockAudioContext = this;
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('AudioCapture', () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const originalNavigator = globalThis.navigator;

  let mockGetUserMedia: ReturnType<typeof createMockGetUserMedia>;

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
    mockAudioContext = null;
    mockWorkletNode = null;
    mockGetUserMedia = createMockGetUserMedia(true);

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
          getUserMedia: (constraints: MediaStreamConstraints) =>
            mockGetUserMedia(constraints),
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

  it('starts capture and sets isReady to true', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });

    expect(capture.isReady).toBe(false);

    await capture.start();

    expect(capture.isReady).toBe(true);
  });

  it('emits audio events with PCM16 and Float32 data', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });
    const receivedAudio: { pcm16: Uint8Array; float32: Float32Array }[] = [];

    capture.on('audio', (pcm16, float32) => {
      receivedAudio.push({ pcm16, float32 });
    });

    await capture.start();

    // Simulate worklet sending audio data
    const testFloat32 = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    mockWorkletNode?.port.simulateMessage(testFloat32);

    await flush();

    expect(receivedAudio.length).toBe(1);
    expect(receivedAudio[0].float32).toEqual(testFloat32);
    // PCM16 should be 2 bytes per sample
    expect(receivedAudio[0].pcm16.length).toBe(testFloat32.length * 2);
  });

  it('converts Float32 to PCM16 correctly', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });
    let receivedPcm16: Uint8Array | null = null;

    capture.on('audio', (pcm16) => {
      receivedPcm16 = pcm16;
    });

    await capture.start();

    // Test edge cases: max positive, max negative, zero
    const testFloat32 = new Float32Array([1.0, -1.0, 0.0]);
    mockWorkletNode?.port.simulateMessage(testFloat32);

    await flush();

    expect(receivedPcm16).not.toBeNull();
    if (!receivedPcm16) {
      throw new Error('Expected PCM16 data to be emitted');
    }
    const emittedPcm16 = receivedPcm16 as Uint8Array;
    const view = new DataView(emittedPcm16.buffer as ArrayBuffer);

    // 1.0 → 0x7FFF (32767)
    expect(view.getInt16(0, true)).toBe(0x7fff);
    // -1.0 → -0x8000 (-32768)
    expect(view.getInt16(2, true)).toBe(-0x8000);
    // 0.0 → 0
    expect(view.getInt16(4, true)).toBe(0);
  });

  it('stops capture and releases resources', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });

    await capture.start();
    expect(capture.isReady).toBe(true);

    capture.stop();

    expect(capture.isReady).toBe(false);
    expect(mockAudioContext?.state).toBe('closed');
  });

  it('calling stop() multiple times is safe', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });

    await capture.start();

    // Should not throw
    capture.stop();
    capture.stop();
    capture.stop();

    expect(capture.isReady).toBe(false);
  });

  it('calling start() when already capturing is a no-op', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });

    await capture.start();
    const firstContext = mockAudioContext;

    await capture.start(); // Should be ignored

    // Same context, no new one created
    expect(mockAudioContext).toBe(firstContext);
    expect(capture.isReady).toBe(true);
  });

  it('emits error event when getUserMedia fails', async () => {
    mockGetUserMedia = createMockGetUserMedia(false);
    Object.defineProperty(globalThis.navigator.mediaDevices, 'getUserMedia', {
      value: mockGetUserMedia,
      configurable: true,
      writable: true,
    });

    const capture = new AudioCapture({ sampleRate: 16000 });
    const errors: Error[] = [];

    capture.on('error', (err) => {
      errors.push(err);
    });

    await capture.start();
    await flush();

    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('Permission denied');
    expect(capture.isReady).toBe(false);
  });

  it('unsubscribes listeners returned by on()', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });
    let audioCount = 0;

    const unsubscribe = capture.on('audio', () => {
      audioCount += 1;
    });

    await capture.start();

    // First event should be counted
    mockWorkletNode?.port.simulateMessage(new Float32Array([0.1]));
    await flush();
    expect(audioCount).toBe(1);

    // Unsubscribe
    unsubscribe();

    // Second event should NOT be counted
    mockWorkletNode?.port.simulateMessage(new Float32Array([0.2]));
    await flush();
    expect(audioCount).toBe(1);
  });

  it('destroy() is an alias for stop()', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });

    await capture.start();
    expect(capture.isReady).toBe(true);

    capture.destroy();

    expect(capture.isReady).toBe(false);
    expect(mockAudioContext?.state).toBe('closed');
  });

  it('emits independent data for multiple consecutive chunks', async () => {
    const capture = new AudioCapture({ sampleRate: 16000 });
    const receivedAudio: { pcm16: Uint8Array; float32: Float32Array }[] = [];

    capture.on('audio', (pcm16, float32) => {
      receivedAudio.push({ pcm16: new Uint8Array(pcm16), float32: new Float32Array(float32) });
    });

    await capture.start();

    const chunk1 = new Float32Array([0.1, 0.2, 0.3]);
    const chunk2 = new Float32Array([0.4, 0.5, 0.6]);
    const chunk3 = new Float32Array([-0.1, -0.2, -0.3]);

    mockWorkletNode?.port.simulateMessage(chunk1);
    mockWorkletNode?.port.simulateMessage(chunk2);
    mockWorkletNode?.port.simulateMessage(chunk3);

    await flush();

    expect(receivedAudio.length).toBe(3);

    // Each chunk should have independent float32 data
    expect(receivedAudio[0].float32).toEqual(chunk1);
    expect(receivedAudio[1].float32).toEqual(chunk2);
    expect(receivedAudio[2].float32).toEqual(chunk3);

    // Each chunk should have independent PCM16 data (2 bytes per sample)
    expect(receivedAudio[0].pcm16.length).toBe(chunk1.length * 2);
    expect(receivedAudio[1].pcm16.length).toBe(chunk2.length * 2);
    expect(receivedAudio[2].pcm16.length).toBe(chunk3.length * 2);

    // Verify data differs between chunks (no buffer reuse corruption)
    expect(receivedAudio[0].pcm16).not.toEqual(receivedAudio[1].pcm16);
    expect(receivedAudio[1].pcm16).not.toEqual(receivedAudio[2].pcm16);
  });

  it('isolates throwing audio listener from later listeners', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};

    const capture = new AudioCapture({ sampleRate: 44100 });
    let secondCalled = false;

    capture.on('audio', () => {
      throw new Error('first listener throws');
    });
    capture.on('audio', () => {
      secondCalled = true;
    });

    await capture.start();
    const workletNode = mockWorkletNode;
    expect(workletNode).not.toBeNull();

    expect(() => {
      workletNode?.port.simulateMessage(new Float32Array([0.1, -0.1]));
    }).not.toThrow();

    expect(secondCalled).toBe(true);

    capture.stop();
    console.error = originalConsoleError;
  });
});
