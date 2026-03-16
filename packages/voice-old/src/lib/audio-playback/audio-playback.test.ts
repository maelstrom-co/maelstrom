import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { AudioPlayback } from './audio-playback.js';

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
    queueMicrotask(() => {
      if (this.ended) return;
      this.ended = true;
      this.onended?.();
    });
  }

  stop(): void {
    if (this.ended) return;
    this.ended = true;
    this.onended?.();
  }
}

class MockAudioContext {
  static sourceCount = 0;

  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;

  constructor(readonly options?: AudioContextOptions) {}

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): MockAudioBuffer {
    return new MockAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): MockAudioBufferSourceNode {
    MockAudioContext.sourceCount += 1;
    return new MockAudioBufferSourceNode(this);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const toPcmF32le = (samples: number[]): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => {
    view.setFloat32(index * 4, sample, true);
  });
  return bytes;
};

describe('AudioPlayback', () => {
  const originalAudioContext = globalThis.AudioContext;
  const originalPerformanceNow = performance.now;

  beforeEach(() => {
    MockAudioContext.sourceCount = 0;
    Object.defineProperty(globalThis, 'AudioContext', {
      value: MockAudioContext,
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

    Object.defineProperty(performance, 'now', {
      value: originalPerformanceNow,
      configurable: true,
      writable: true,
    });
  });

  it('emits playbackStart then playbackEnd when audio is played', async () => {
    const playback = new AudioPlayback({ sampleRate: 44100 });
    const events: string[] = [];

    playback.on('playbackStart', () => events.push('start'));
    playback.on('playbackEnd', () => events.push('end'));

    playback.enqueue(toPcmF32le([0.1, -0.1, 0.2, -0.2]));
    await flush();

    expect(events).toEqual(['start', 'end']);
    expect(playback.isPlaying).toBe(false);
  });

  it('interrupt stops playback and emits playbackEnd once', async () => {
    const playback = new AudioPlayback({ sampleRate: 44100 });
    let endCount = 0;

    playback.on('playbackEnd', () => {
      endCount += 1;
    });

    playback.enqueue(toPcmF32le([0.3, -0.3, 0.4, -0.4]));
    playback.interrupt();
    await flush();

    expect(endCount).toBe(1);
    expect(playback.isPlaying).toBe(false);
  });

  it('drops stale packets and does not start playback', async () => {
    let now = 100;
    Object.defineProperty(performance, 'now', {
      value: () => {
        now += 200;
        return now;
      },
      configurable: true,
      writable: true,
    });

    const playback = new AudioPlayback({
      sampleRate: 44100,
      maxPacketAgeMs: 10,
    });
    let startCalled = false;

    playback.on('playbackStart', () => {
      startCalled = true;
    });

    playback.enqueue(toPcmF32le([0.1, 0.2, 0.3, 0.4]));
    await flush();

    expect(startCalled).toBe(false);
    expect(MockAudioContext.sourceCount).toBe(0);
    expect(playback.isPlaying).toBe(false);
  });

  it('unsubscribes listeners returned by on()', async () => {
    const playback = new AudioPlayback({ sampleRate: 44100 });
    let startCount = 0;
    const unsubscribe = playback.on('playbackStart', () => {
      startCount += 1;
    });

    unsubscribe();
    playback.enqueue(toPcmF32le([0.1, -0.1]));
    await flush();

    expect(startCount).toBe(0);
  });
});
