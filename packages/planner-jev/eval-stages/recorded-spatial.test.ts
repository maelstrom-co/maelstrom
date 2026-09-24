import { describe, expect, test } from 'bun:test';

import { recordedSpatialSignal } from './recorded-spatial.js';

const ARM = 'jev-gated-per-instance-composed-pairs-inline';

function liveRecord(
  arm: string,
  scenarioId: string,
  repeat: number,
  spatial?: { answer: string; probability: number; confidence: number },
) {
  return {
    arm,
    scenarioId,
    repeat,
    stageOutputs: {
      jevSelect: spatial ? { instances: [], gates: { spatial } } : undefined,
    },
  };
}

describe('recorded spatial signal', () => {
  test('keeps the spatial gate the named arm answered, per scenario and repeat', () => {
    const signal = recordedSpatialSignal(
      [
        liveRecord(ARM, 'swap', 1, {
          answer: 'no',
          probability: 0.47,
          confidence: 0.6,
        }),
        liveRecord(ARM, 'swap', 2, {
          answer: 'yes',
          probability: 0.52,
          confidence: 0.6,
        }),
        liveRecord('jev-poc', 'swap', 3, {
          answer: 'yes',
          probability: 0.9,
          confidence: 0.9,
        }),
        liveRecord(ARM, 'compare', 1),
      ],
      ARM,
    );
    expect(signal.lookup('swap', 1)).toEqual({
      answer: 'no',
      probability: 0.47,
      confidence: 0.6,
    });
    expect(signal.lookup('swap', 2)?.answer).toBe('yes');
    expect(signal.lookup('swap', 3)).toBeUndefined();
    expect(signal.lookup('compare', 1)).toBeUndefined();
    expect(signal.size).toBe(2);
  });

  test('reads the answer from the probability, as the gated select stage does', () => {
    const signal = recordedSpatialSignal(
      [
        liveRecord(ARM, 'swap', 1, {
          answer: 'maybe',
          probability: 0.5,
          confidence: 0.6,
        }),
      ],
      ARM,
    );
    expect(signal.lookup('swap', 1)?.answer).toBe('yes');
  });
});
