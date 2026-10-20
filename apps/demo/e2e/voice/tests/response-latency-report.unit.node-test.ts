import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCiMetric, VoiceMetricRejection } from '../ci-metrics.ts';
import {
  summarizeVoiceBenchmark,
  type VoiceBenchmarkRecord,
} from './benchmark-metrics.ts';
import {
  assessResponseLatencyRun,
  completeResponseLatencyReport,
} from './response-latency-report.ts';
import {
  type AudioTimelineMeasurement,
  computeAudioTimelineMeasurement,
  fixtureCommandSpeechEnvelopes,
  mergeHumanSpeechSegments,
} from './shared-audio-timeline.ts';
import {
  addAttemptFailure,
  attachReportAndCleanup,
} from './single-turn-validity.ts';

function measure(
  bursts: readonly (readonly [number, number])[],
  options: { missingBlocks?: number; speech?: boolean } = {},
) {
  const inputPcm16 = Buffer.alloc(2_000 * 2);
  const assistantPcm16 = Buffer.alloc(inputPcm16.length);
  for (const [start, end] of bursts)
    for (let frame = start; frame < end; frame++)
      assistantPcm16.writeInt16LE(12_000, frame * 2);
  return computeAudioTimelineMeasurement({
    inputPcm16,
    assistantPcm16,
    inputChannels: 1,
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments:
      options.speech === false
        ? []
        : [
            { startSample: 100, endSample: 200 },
            { startSample: 1_000, endSample: 1_200 },
          ],
    missingBlocks: options.missingBlocks ?? 0,
  });
}

function report(
  latency: AudioTimelineMeasurement,
  executionFailed = false,
  scenarios = ['only-tasks', 'open-calendar'],
) {
  const validation = assessResponseLatencyRun(latency, executionFailed);
  const records: VoiceBenchmarkRecord[] = scenarios.map((scenario) => ({
    scenario,
    repetition: 1,
    assistantCapturedAudioActiveMs: 150,
    measurements: {
      bargeIn: 'unsupported',
      assistantTranscriptWordCount: 'unsupported',
      assistantSpeechWpm: 'unsupported',
    },
  }));
  return {
    benchmark: 'playwright-voice',
    mode: 'full-scenario-suite',
    status: validation.status,
    validation,
    responseLatency: latency,
    summary: summarizeVoiceBenchmark(
      records,
      latency,
      addAttemptFailure(
        0,
        executionFailed || validation.status === 'failed',
        null,
      ),
    ),
    records,
  };
}

const complete = (
  value: ReturnType<typeof report>,
  attached: unknown[],
  order: string[],
) =>
  attachReportAndCleanup(
    value,
    (output) =>
      completeResponseLatencyReport(
        output,
        output.validation,
        async (evidence) => {
          attached.push(evidence);
          order.push('attached');
        },
      ),
    [
      async () => {
        order.push('cleanup');
      },
    ],
  );

test('complete measured producer output passes the CI extractor with the same p95 population', async () => {
  const measurement = measure([
    [250, 400],
    [1_320, 1_500],
  ]);
  const original = structuredClone(measurement);
  const output = report(measurement);
  assert.deepEqual(output.validation, { status: 'passed', reasons: [] });
  assert.equal(output.summary.failures, 0);
  assert.deepEqual(extractCiMetric('voice-benchmark.json', output), {
    p95Ms: 120,
    samples: 2,
  });
  const attached: unknown[] = [];
  const order: string[] = [];
  await complete(output, attached, order);
  assert.deepEqual(order, ['attached', 'cleanup']);
  assert.deepEqual(attached, [output]);
  assert.deepEqual(measurement, original);
});

for (const scenario of [
  {
    name: 'partial',
    measurement: () => measure([[250, 400]]),
    code: 'assistant-onset-missing',
  },
  {
    name: 'missing onset',
    measurement: () => measure([]),
    code: 'assistant-onset-missing',
  },
  {
    name: 'overlap',
    measurement: () =>
      measure([
        [150, 400],
        [1_100, 1_500],
      ]),
    code: 'assistant-overlap',
  },
  {
    name: 'no captured VAD',
    measurement: () => measure([], { speech: false }),
    code: 'no-human-speech',
  },
  {
    name: 'capture gap',
    measurement: () => measure([], { missingBlocks: 1 }),
    code: 'capture-incomplete',
  },
]) {
  test(`${scenario.name} attaches evidence and cleans up before failing both test and metric eligibility`, async () => {
    const measurement = scenario.measurement();
    const before = structuredClone(measurement);
    const output = report(measurement);
    assert.equal(output.status, 'failed');
    assert.equal(output.summary.failures, 1);
    assert.ok(
      output.validation.reasons.includes(
        scenario.code as (typeof output.validation.reasons)[number],
      ),
    );
    assert.throws(
      () => extractCiMetric('voice-benchmark.json', output),
      (error) =>
        error instanceof VoiceMetricRejection &&
        error.reason === 'benchmark-failed',
    );
    const attached: unknown[] = [];
    const order: string[] = [];
    await assert.rejects(
      complete(output, attached, order),
      new RegExp(scenario.code),
    );
    order.push('failed');
    assert.deepEqual(order, ['attached', 'cleanup', 'failed']);
    assert.deepEqual(attached, [output]);
    assert.deepEqual(measurement, before);
    // Retain diagnostic partial samples; they must not become a valid lane.
    assert.equal(
      output.summary.responseLatencyMs.sampleCount,
      measurement.turns.filter((turn) => turn.status === 'measured').length,
    );
  });
}

test('execution failure is counted once even with unsupported latency', () => {
  const output = report(measure([]), true);
  assert.equal(output.status, 'failed');
  assert.equal(output.summary.failures, 1);
  assert.ok(output.validation.reasons.includes('scenario-failed'));
});

test('a measured status without a nonempty valid population cannot pass the producer', () => {
  assert.deepEqual(
    assessResponseLatencyRun({ status: 'measured', t0Sample: 0, turns: [] }),
    {
      status: 'failed',
      reasons: ['no-measured-turns'],
    },
  );
  const measured = measure([
    [250, 400],
    [1_320, 1_500],
  ]);
  for (const latencyMs of [null, -1, NaN, Infinity, 600_001]) {
    const invalid = {
      ...measured,
      turns: measured.turns.map((turn) => ({ ...turn, latencyMs })),
    };
    assert.deepEqual(assessResponseLatencyRun(invalid), {
      status: 'failed',
      reasons: ['invalid-latency'],
    });
    assert.throws(() =>
      extractCiMetric('voice-benchmark.json', report(invalid)),
    );
  }
});

test('unknown or repeated reasons cannot leak raw capture or provider data into failure diagnostics', async () => {
  const latency: AudioTimelineMeasurement = {
    ...measure([]),
    reason: 'secret-canary',
    turns: measure([]).turns.map((turn) => ({
      ...turn,
      reason: 'secret-canary',
    })),
  };
  const output = report(latency);
  assert.deepEqual(output.validation.reasons, ['latency-unmeasured']);
  assert.doesNotMatch(JSON.stringify(output.validation), /secret-canary/);
  await assert.rejects(
    completeResponseLatencyReport(output, output.validation, async () => {}),
    {
      message: 'Full-scenario response latency invalid: latency-unmeasured',
    },
  );
});

test('capture and VAD setup reasons use closed codes without changing latency evidence', () => {
  for (const [reason, code] of [
    ['Shared audio capture or VAD failed.', 'capture-failed'],
    ['Shared browser audio timeline was not captured.', 'capture-failed'],
    [
      'AudioWorklet capture frame counts did not validate against its shared currentFrame timeline.',
      'capture-misaligned',
    ],
    [
      'AudioWorklet reported 12 missing or format-changing blocks.',
      'capture-incomplete',
    ],
    ['Captured VAD data failed validation.', 'vad-invalid'],
    [
      'VAD returned offsets in a format other than the captured source sample clock.',
      'vad-clock-mismatch',
    ],
  ]) {
    const latency: AudioTimelineMeasurement = {
      status: 'unsupported',
      t0Sample: null,
      turns: [],
      reason,
    };
    assert.deepEqual(assessResponseLatencyRun(latency).reasons, [
      code,
      'no-measured-turns',
    ]);
  }
});

test('an attachment failure still cleans up without replacing the original error', async () => {
  const output = report(measure([]));
  const failure = new Error('attachment unavailable');
  let cleaned = false;
  await assert.rejects(
    attachReportAndCleanup(
      output,
      (evidence) =>
        completeResponseLatencyReport(evidence, output.validation, async () => {
          throw failure;
        }),
      [
        async () => {
          cleaned = true;
        },
      ],
    ),
    (error) => error === failure,
  );
  assert.equal(cleaned, true);
});

test('three fixture commands with a 640ms internal pause produce three measured latencies, not a missing fourth reply', () => {
  const capture = { startFrame: 143_872, endFrame: 3_889_280 };
  const rawSegments = [
    { startSample: 301_056, endSample: 334_848 },
    { startSample: 1_801_728, endSample: 1_947_648 },
    { startSample: 3_412_992, endSample: 3_482_112 },
    { startSample: 3_512_832, endSample: 3_526_656 },
  ];
  const playbackWindows = [
    { workletStartFrame: 204_288, workletEndFrame: 493_952 },
    { workletStartFrame: 1_789_568, workletEndFrame: 2_105_344 },
    { workletStartFrame: 3_402_240, workletEndFrame: 3_699_584 },
  ];
  const inputPcm16 = Buffer.alloc((capture.endFrame - capture.startFrame) * 2);
  const assistantPcm16 = Buffer.alloc(inputPcm16.length);
  for (const onset of [416_655, 2_034_606, 3_652_937])
    for (let frame = onset; frame < onset + 1_000; frame++)
      assistantPcm16.writeInt16LE(12_000, frame * 2);
  const args = {
    inputPcm16,
    assistantPcm16,
    inputChannels: 1,
    assistantChannels: 1,
    sampleRate: 48_000,
    missingBlocks: 0,
  };
  const oldMeasurement = computeAudioTimelineMeasurement({
    ...args,
    speechSegments: mergeHumanSpeechSegments(rawSegments, 48_000),
  });
  assert.equal(oldMeasurement.status, 'partial');
  assert.equal(oldMeasurement.turns.length, 4);
  assert.match(oldMeasurement.turns[2]?.reason ?? '', /No assistant onset/);
  const grouping = fixtureCommandSpeechEnvelopes(
    rawSegments,
    playbackWindows,
    capture,
  );
  assert.equal(grouping.status, 'grouped');
  if (grouping.status !== 'grouped') throw new Error('Fixture grouping failed');
  const measurement = computeAudioTimelineMeasurement({
    ...args,
    speechSegments: grouping.windows.map((window) => window.speech),
    responseWindowEndSamples: grouping.windows.map(
      (window) => window.responseEndSample,
    ),
  });
  assert.equal(measurement.status, 'measured');
  assert.equal(measurement.t0Sample, rawSegments[0]?.startSample);
  assert.deepEqual(
    measurement.turns.map((turn) => turn.latencyMs),
    [1_704.3125, 1_811.625, 2_630.8541666666665],
  );
  assert.deepEqual(
    measurement.turns.slice(0, 2),
    oldMeasurement.turns.slice(0, 2),
  );
  assert.equal(measurement.turns[2]?.vadStartSample, 3_412_992);
  assert.equal(measurement.turns[2]?.vadEndSample, 3_526_656);
  assert.equal(measurement.turns[2]?.assistantOnsetSample, 3_652_937);
  const output = report(measurement, false, [
    'only-tasks',
    'open-calendar',
    'put-it-back',
  ]);
  assert.equal(output.summary.sampleCount, 3);
  assert.equal(output.status, 'passed');
  assert.deepEqual(extractCiMetric('voice-benchmark.json', output), {
    p95Ms: 2_630.8541666666665,
    samples: 3,
  });
});

test('fixture attribution failures remain invalid with bounded diagnostics', () => {
  const capture = { startFrame: 1_000, endFrame: 3_000 };
  const segments = [{ startSample: 100, endSample: 300 }];
  for (const [windows, expected] of [
    [[], 'fixture-window-invalid'],
    [
      [
        { workletStartFrame: 1_000, workletEndFrame: 1_500 },
        { workletStartFrame: 2_000, workletEndFrame: 2_500 },
      ],
      'fixture-speech-missing',
    ],
    [
      [{ workletStartFrame: 1_200, workletEndFrame: 1_500 }],
      'fixture-speech-unassigned',
    ],
  ] as const) {
    const grouping = fixtureCommandSpeechEnvelopes(segments, windows, capture);
    assert.equal(grouping.status, 'unsupported');
    if (grouping.status !== 'unsupported')
      throw new Error('Expected rejected grouping');
    const output = report({
      status: 'unsupported',
      t0Sample: null,
      turns: [],
      reason: grouping.reason,
    });
    assert.equal(output.status, 'failed');
    assert.ok(output.validation.reasons.some((reason) => reason === expected));
    assert.equal(output.summary.failures, 1);
    assert.throws(() => extractCiMetric('voice-benchmark.json', output));
  }
});
