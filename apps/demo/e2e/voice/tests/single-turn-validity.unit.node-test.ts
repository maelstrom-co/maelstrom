import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeVoiceBenchmark } from './benchmark-metrics.ts';
import type { AudioTimelineMeasurement } from './shared-audio-timeline.ts';
import {
  addAttemptFailure,
  analyzeSingleTurnValidity,
  attachReportAndCleanup,
  calculateSpeechCoverage,
  classifySingleTurnValidity,
  requireNonemptyFixtureVad,
  singleTurnMinimumVadCoverageRatio,
  suppressInvalidSingleTurnLatency,
  validateVadPayload,
} from './single-turn-validity.ts';

const expected = [
  { startSample: 0, endSample: 1_100 },
  { startSample: 2_000, endSample: 3_044 },
];

const measured: AudioTimelineMeasurement = {
  status: 'measured',
  t0Sample: 0,
  turns: [
    {
      status: 'measured',
      vadStartSample: 0,
      vadEndSample: 3_044,
      vadEndOffsetFromT0Samples: 3_044,
      assistantOnsetSample: 3_500,
      assistantOnsetOffsetFromT0Samples: 3_500,
      latencySamples: 456,
      latencyMs: 456,
    },
  ],
};

test('calculates speech coverage from summed active VAD duration across source rates', () => {
  const coverage = calculateSpeechCoverage({
    expectedSegments: expected,
    expectedSampleRate: 1_000,
    capturedSegments: [
      { startSample: 0, endSample: 900 },
      { startSample: 2_000, endSample: 2_892 },
    ],
    capturedSampleRate: 1_000,
  });
  assert.equal(coverage.expectedActiveMs, 2_144);
  assert.equal(coverage.capturedActiveMs, 1_792);
  assert.ok(Math.abs((coverage.coverageRatio ?? 0) - 0.8358208955) < 1e-9);

  const normalized = calculateSpeechCoverage({
    expectedSegments: [{ startSample: 0, endSample: 21_440 }],
    expectedSampleRate: 10_000,
    capturedSegments: [{ startSample: 0, endSample: 17_920 }],
    capturedSampleRate: 10_000,
  });
  assert.equal(normalized.coverageRatio, coverage.coverageRatio);
});

test('valid local coverage passes while 19.4% and 4.5% coverage fail', () => {
  const localhost = calculateSpeechCoverage({
    expectedSegments: expected,
    expectedSampleRate: 1_000,
    capturedSegments: [{ startSample: 0, endSample: 1_792 }],
    capturedSampleRate: 1_000,
  });
  const observedLive = calculateSpeechCoverage({
    expectedSegments: expected,
    expectedSampleRate: 1_000,
    capturedSegments: [{ startSample: 0, endSample: 416 }],
    capturedSampleRate: 1_000,
  });
  const veryLow = calculateSpeechCoverage({
    expectedSegments: expected,
    expectedSampleRate: 1_000,
    capturedSegments: [{ startSample: 0, endSample: 96 }],
    capturedSampleRate: 1_000,
  });
  assert.ok(
    (localhost.coverageRatio ?? 0) >= singleTurnMinimumVadCoverageRatio,
  );
  assert.ok(Math.abs((observedLive.coverageRatio ?? 0) - 0.1940298507) < 1e-9);
  assert.ok(
    (observedLive.coverageRatio ?? 1) < singleTurnMinimumVadCoverageRatio,
  );
  assert.ok((veryLow.coverageRatio ?? 1) < singleTurnMinimumVadCoverageRatio);
  assert.equal(classifySingleTurnValidity(measured, localhost).valid, true);
  assert.deepEqual(classifySingleTurnValidity(measured, observedLive).reasons, [
    'captured-vad-coverage-below-minimum',
  ]);
  assert.deepEqual(classifySingleTurnValidity(measured, veryLow).reasons, [
    'captured-vad-coverage-below-minimum',
  ]);
});

test('classifies early assistant onset and overlap as invalid without changing latency', () => {
  const coverage = calculateSpeechCoverage({
    expectedSegments: expected,
    expectedSampleRate: 1_000,
    capturedSegments: expected,
    capturedSampleRate: 1_000,
  });
  for (const reason of [
    'Assistant audio began before the human command speech ended.',
    'Assistant audio overlapped the human VAD turn.',
  ]) {
    const latency: AudioTimelineMeasurement = {
      status: 'unsupported',
      t0Sample: 0,
      turns: [
        {
          status: 'unsupported',
          vadStartSample: 0,
          vadEndSample: 3_044,
          vadEndOffsetFromT0Samples: 3_044,
          assistantOnsetSample: null,
          assistantOnsetOffsetFromT0Samples: null,
          latencySamples: null,
          latencyMs: null,
          reason,
        },
      ],
    };
    const validity = classifySingleTurnValidity(latency, coverage);
    assert.deepEqual(validity.reasons, [
      'assistant-onset-overlapped-human-speech',
    ]);
    const rejected = suppressInvalidSingleTurnLatency(measured, validity);
    assert.equal(rejected.status, 'unsupported');
    assert.deepEqual(rejected.turns, []);
  }
});

test('null coverage is unavailable, not below threshold, and suppresses latency', () => {
  const analysis = analyzeSingleTurnValidity({
    latency: measured,
    expected: {
      segments: expected,
      sampleRate: 1_000,
    },
    captured: null,
    malformedVadInput: false,
    captureFailed: true,
  });
  assert.deepEqual(analysis.validity.reasons, [
    'vad-coverage-unavailable',
    'capture-failed',
  ]);
  assert.equal(
    analysis.validity.reasons.includes('captured-vad-coverage-below-minimum'),
    false,
  );
  const rejected = suppressInvalidSingleTurnLatency(
    measured,
    analysis.validity,
  );
  assert.equal(rejected.status, 'unsupported');
  assert.deepEqual(rejected.turns, []);
  assert.equal(
    summarizeVoiceBenchmark([], rejected).responseLatencyMs.sampleCount,
    0,
  );
});

test('suppresses a measured candidate when VAD coverage invalidates the attempt', () => {
  const lowCoverage = calculateSpeechCoverage({
    expectedSegments: expected,
    expectedSampleRate: 1_000,
    capturedSegments: [{ startSample: 0, endSample: 96 }],
    capturedSampleRate: 1_000,
  });
  const validity = classifySingleTurnValidity(measured, lowCoverage);
  const rejected = suppressInvalidSingleTurnLatency(measured, validity);
  assert.deepEqual(rejected, {
    status: 'unsupported',
    t0Sample: null,
    turns: [],
    reason: 'Single-turn attempt invalid: captured-vad-coverage-below-minimum',
  });
  assert.equal(
    summarizeVoiceBenchmark([], rejected).responseLatencyMs.sampleCount,
    0,
  );
});

test('rejects empty and malformed fixture VAD before playback but accepts valid multiple islands', () => {
  const empty = validateVadPayload(
    { sampleRate: 16_000, channels: 1, segments: [] },
    100,
  );
  assert.throws(() => requireNonemptyFixtureVad(empty), /no speech segments/);

  const malformed = validateVadPayload(
    { sampleRate: 0, channels: 1, segments: [] },
    100,
  );
  assert.throws(() => requireNonemptyFixtureVad(malformed), /malformed/);

  const multipleIslands = validateVadPayload(
    {
      sampleRate: 16_000,
      channels: 1,
      segments: [
        { StartSample: 0, EndSample: 10 },
        { StartSample: 20, EndSample: 30 },
      ],
    },
    100,
  );
  assert.equal(requireNonemptyFixtureVad(multipleIslands).segments.length, 2);
  assert.throws(
    () =>
      requireNonemptyFixtureVad(multipleIslands, {
        sampleRate: 48_000,
        channels: 1,
      }),
    /sample clock does not match source/,
  );
});

test('rejects finite non-integer and non-finite VAD rates and coverage rates', () => {
  for (const sampleRate of [0, 16_000.5, Number.NaN, Infinity]) {
    assert.equal(
      validateVadPayload({ sampleRate, channels: 1, segments: [] }, 100).valid,
      false,
    );
    assert.throws(() =>
      calculateSpeechCoverage({
        expectedSegments: expected,
        expectedSampleRate: sampleRate,
        capturedSegments: expected,
        capturedSampleRate: 1_000,
      }),
    );
  }
});

test('turns unexpected coverage analysis errors into invalid diagnostics', () => {
  const analysis = analyzeSingleTurnValidity({
    latency: measured,
    expected: {
      segments: expected,
      sampleRate: 1_000.5,
    },
    captured: { segments: expected, sampleRate: 1_000 },
    malformedVadInput: false,
    captureFailed: false,
  });
  assert.equal(analysis.analysisFailed, true);
  assert.equal(analysis.coverage, null);
  assert.ok(analysis.validity.reasons.includes('capture-failed'));
});

test('adds a failed scenario once when execution and final invalidation both mark failure', () => {
  assert.equal(addAttemptFailure(0, true, 'capture-failed'), 1);
  assert.equal(addAttemptFailure(0, true, null), 1);
  assert.equal(addAttemptFailure(0, false, 'invalid-coverage'), 1);
  assert.equal(addAttemptFailure(1, false, null), 1);
});

test('validates finite positive VAD rates and bounded sorted non-overlapping segments', () => {
  const valid = validateVadPayload(
    {
      sampleRate: 16_000,
      channels: 1,
      segments: [
        { StartSample: 10, EndSample: 30 },
        { StartSample: 40, EndSample: 50 },
      ],
    },
    60,
  );
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.segments, [
    { startSample: 10, endSample: 30 },
    { startSample: 40, endSample: 50 },
  ]);

  const zeroRate = validateVadPayload(
    { sampleRate: 0, channels: 1, segments: [] },
    100,
  );
  assert.equal(zeroRate.reason, 'invalid-sample-rate');
  assert.deepEqual(
    classifySingleTurnValidity(
      measured,
      {
        expectedActiveMs: 2_144,
        capturedActiveMs: 0,
        coverageRatio: null,
        minimumCoverageRatio: singleTurnMinimumVadCoverageRatio,
      },
      { malformedVadInput: !zeroRate.valid },
    ).reasons,
    ['vad-coverage-unavailable', 'malformed-vad-input'],
  );
  assert.equal(
    validateVadPayload(
      {
        sampleRate: 16_000,
        channels: 1,
        segments: [
          { StartSample: 10, EndSample: 40 },
          { StartSample: 30, EndSample: 50 },
        ],
      },
      100,
    ).reason,
    'invalid-vad-segments',
  );
  assert.equal(
    validateVadPayload(
      {
        sampleRate: 16_000,
        channels: 1,
        segments: [
          { StartSample: 40, EndSample: 50 },
          { StartSample: 10, EndSample: 30 },
        ],
      },
      100,
    ).reason,
    'invalid-vad-segments',
  );
  assert.equal(
    validateVadPayload(
      {
        sampleRate: 16_000,
        channels: 1,
        segments: [{ StartSample: 10, EndSample: 101 }],
      },
      100,
    ).reason,
    'invalid-vad-segments',
  );
});

test('attaches the diagnostic before attempting both cleanup steps', async () => {
  const order: string[] = [];
  await attachReportAndCleanup(
    { safe: true },
    async (report) => {
      assert.deepEqual(report, { safe: true });
      order.push('attach');
    },
    [
      async () => {
        order.push('stop-voice');
      },
      async () => {
        order.push('stop-capture');
      },
    ],
  );
  assert.deepEqual(order, ['attach', 'stop-voice', 'stop-capture']);
});

test('still attempts both cleanup steps when report attachment fails', async () => {
  const order: string[] = [];
  await assert.rejects(
    attachReportAndCleanup({ safe: true }, async () => {
      order.push('attach');
      throw new Error('attachment failure');
    }, [
      async () => {
        order.push('stop-voice');
      },
      async () => {
        order.push('stop-capture');
      },
    ]),
    /attachment failure/,
  );
  assert.deepEqual(order, ['attach', 'stop-voice', 'stop-capture']);
});

test('does not classify unrelated unsupported latency as early overlap', () => {
  const coverage = calculateSpeechCoverage({
    expectedSegments: expected,
    expectedSampleRate: 1_000,
    capturedSegments: expected,
    capturedSampleRate: 1_000,
  });
  const latency: AudioTimelineMeasurement = {
    status: 'unsupported',
    t0Sample: 0,
    turns: [
      {
        status: 'unsupported',
        vadStartSample: 0,
        vadEndSample: 3_044,
        vadEndOffsetFromT0Samples: 3_044,
        assistantOnsetSample: null,
        assistantOnsetOffsetFromT0Samples: null,
        latencySamples: null,
        latencyMs: null,
        reason:
          'No assistant onset occurred before the next human VAD turn or capture end.',
      },
    ],
  };
  assert.deepEqual(classifySingleTurnValidity(latency, coverage), {
    valid: true,
    reasons: [],
  });
});
