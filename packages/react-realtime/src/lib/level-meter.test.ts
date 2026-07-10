import { describe, expect, it } from 'bun:test';
import { createLevelMeter } from './level-meter.js';

function makeFakeAudioContext(fillByte: number) {
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 128,
    getByteTimeDomainData(arr: Uint8Array) {
      arr.fill(fillByte);
    },
  };
  const context = {
    closed: false,
    createMediaStreamSource: () => ({ connect: () => {} }),
    createAnalyser: () => analyser,
    close() {
      this.closed = true;
      return Promise.resolve();
    },
  };
  return { context: context as unknown as AudioContext, analyser, raw: context };
}

describe('createLevelMeter', () => {
  it('reads 0 for silence (samples at the 128 midpoint)', () => {
    const { context } = makeFakeAudioContext(128);
    const meter = createLevelMeter({} as MediaStream, () => context);
    expect(meter.read()).toBeCloseTo(0, 2);
  });

  it('reads ~1 for a full-scale signal', () => {
    const { context } = makeFakeAudioContext(255);
    const meter = createLevelMeter({} as MediaStream, () => context);
    expect(meter.read()).toBeGreaterThan(0.9);
  });

  it('closes the context and reads 0 after dispose', () => {
    const { context, raw } = makeFakeAudioContext(255);
    const meter = createLevelMeter({} as MediaStream, () => context);
    meter.dispose();
    expect(raw.closed).toBe(true);
    expect(meter.read()).toBe(0);
  });
});
