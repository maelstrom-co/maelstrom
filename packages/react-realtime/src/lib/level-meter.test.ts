import { beforeEach, describe, expect, it } from 'bun:test';
import { createLevelMeter, resetLevelMeterAudioContextForTesting } from './level-meter.js';

function makeFakeAudioContext(fillByte: number) {
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 128,
    getByteTimeDomainData(arr: Uint8Array) {
      arr.fill(fillByte);
    },
    disconnect() {},
  };
  let resumeCalls = 0;
  let suspendCalls = 0;
  let closeCalls = 0;
  const context = {
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createAnalyser: () => analyser,
    resume() {
      resumeCalls += 1;
      return Promise.resolve();
    },
    suspend() {
      suspendCalls += 1;
      return Promise.resolve();
    },
    close() {
      closeCalls += 1;
      return Promise.resolve();
    },
    get resumeCalls() {
      return resumeCalls;
    },
    get suspendCalls() {
      return suspendCalls;
    },
    get closeCalls() {
      return closeCalls;
    },
  };
  return { context: context as unknown as AudioContext, analyser, raw: context };
}

beforeEach(() => {
  resetLevelMeterAudioContextForTesting();
});

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

  it('reads 0 after dispose', () => {
    const { context } = makeFakeAudioContext(255);
    const meter = createLevelMeter({} as MediaStream, () => context);
    meter.dispose();
    expect(meter.read()).toBe(0);
  });

  it('reuses the same AudioContext across sequential meters instead of building a new one per press', () => {
    let created = 0;
    const factory = () => {
      created += 1;
      return makeFakeAudioContext(255).context;
    };

    const first = createLevelMeter({} as MediaStream, factory);
    first.dispose();
    const second = createLevelMeter({} as MediaStream, factory);
    second.dispose();

    expect(created).toBe(1);
  });

  it('suspends the shared context once the last active meter disposes, and resumes it for the next meter', () => {
    const { context, raw } = makeFakeAudioContext(255);

    const first = createLevelMeter({} as MediaStream, () => context);
    const second = createLevelMeter({} as MediaStream, () => context);
    expect(raw.resumeCalls).toBeGreaterThan(0);

    first.dispose();
    expect(raw.suspendCalls).toBe(0); // second meter is still active

    second.dispose();
    expect(raw.suspendCalls).toBe(1);

    const resumeCallsBeforeThird = raw.resumeCalls;
    const third = createLevelMeter({} as MediaStream, () => context);
    expect(raw.resumeCalls).toBeGreaterThan(resumeCallsBeforeThird);

    third.dispose();
    expect(raw.suspendCalls).toBe(2);
  });

  it('never closes the shared context', () => {
    const { context, raw } = makeFakeAudioContext(255);
    const meter = createLevelMeter({} as MediaStream, () => context);
    meter.dispose();
    expect(raw.closeCalls).toBe(0);
  });

  it('is safe to dispose twice', () => {
    const { context, raw } = makeFakeAudioContext(255);
    const meter = createLevelMeter({} as MediaStream, () => context);
    meter.dispose();
    meter.dispose();
    expect(raw.suspendCalls).toBe(1);
  });
});
