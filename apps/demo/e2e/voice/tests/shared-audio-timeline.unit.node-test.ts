import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeVoiceBenchmark } from './benchmark-metrics.ts';
import {
  computeAudioTimelineMeasurement,
  mergeHumanSpeechSegments,
  singleCommandSpeechEnvelope,
} from './shared-audio-timeline.ts';

function pcm16(samples: readonly number[], channels = 1): Buffer {
  const bytes = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (sample === undefined) throw new Error(`Missing sample ${i}`);
    bytes.writeInt16LE(sample, i * 2);
  }
  assert.equal(samples.length % channels, 0);
  return bytes;
}

function silentPcm16(frames: number): Buffer {
  return Buffer.alloc(frames * 2);
}

function addAssistantBurst(
  pcm: Buffer,
  startSample: number,
  endSample: number,
): void {
  for (let sample = startSample; sample < endSample; sample++)
    pcm.writeInt16LE(12_000, sample * 2);
}

function fixture() {
  const input = new Array<number>(500).fill(0);
  for (let i = 100; i < 180; i++) input[i] = 12_000;
  const assistant = new Array<number>(500).fill(0);
  for (let i = 220; i < 250; i++) assistant[i] = 12_000;
  for (let i = 380; i < 410; i++) assistant[i] = -12_000;
  return { input, assistant };
}

test('uses the first zero-padded VAD sample as t0 and converts a same-clock sample delta', () => {
  const { input, assistant } = fixture();
  const result = computeAudioTimelineMeasurement({
    inputPcm16: pcm16(input),
    inputChannels: 1,
    assistantPcm16: pcm16(assistant),
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [{ startSample: 100, endSample: 180 }],
    missingBlocks: 0,
  });
  assert.equal(result.status, 'measured');
  assert.equal(result.t0Sample, 100);
  assert.deepEqual(result.turns, [
    {
      status: 'measured',
      vadStartSample: 100,
      vadEndSample: 180,
      vadEndOffsetFromT0Samples: 80,
      assistantOnsetSample: 220,
      assistantOnsetOffsetFromT0Samples: 120,
      latencySamples: 40,
      latencyMs: 40,
    },
  ]);
});

test('associates each 90-second VAD window independently instead of guessing after a missing reply', () => {
  const sampleRate = 48_000;
  const frames = sampleRate * 90;
  const speechSegments = [
    { startSample: 248_832, endSample: 367_104 },
    { startSample: 597_504, endSample: 615_936 },
    { startSample: 658_944, endSample: 700_000 },
    { startSample: 1_000_000, endSample: 1_040_000 },
    { startSample: 1_400_000, endSample: 1_440_000 },
    { startSample: 1_800_000, endSample: 1_840_000 },
    { startSample: 2_200_000, endSample: 2_240_000 },
    { startSample: 2_600_000, endSample: 2_640_000 },
    { startSample: 3_000_000, endSample: 3_040_000 },
    { startSample: 3_400_000, endSample: 3_440_000 },
  ];
  const inputPcm16 = silentPcm16(frames);
  const assistantPcm16 = silentPcm16(frames);
  addAssistantBurst(assistantPcm16, 457_421, 458_021);
  for (const segment of speechSegments.slice(2))
    addAssistantBurst(
      assistantPcm16,
      segment.endSample + 50_000,
      segment.endSample + 50_600,
    );

  const result = computeAudioTimelineMeasurement({
    inputPcm16,
    inputChannels: 1,
    assistantPcm16,
    assistantChannels: 1,
    sampleRate,
    speechSegments,
    missingBlocks: 0,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.turns.length, 10);
  assert.deepEqual(
    result.turns.map((turn) => turn.status),
    ['measured', 'unsupported', ...new Array(8).fill('measured')],
  );
  assert.equal(result.turns[0]?.assistantOnsetSample, 457_421);
  assert.equal(result.turns[0]?.latencySamples, 90_317);
  assert.equal(result.turns[0]?.latencyMs, 1_881.6041666666667);
  assert.equal(result.turns[1]?.assistantOnsetSample, null);
  assert.equal(result.turns[1]?.latencySamples, null);
  const laterOnsets = result.turns
    .slice(2)
    .map((turn) => turn.assistantOnsetSample);
  assert.equal(new Set(laterOnsets).size, 8);
  assert.deepEqual(
    laterOnsets,
    speechSegments.slice(2).map((segment) => segment.endSample + 50_000),
  );
  assert.equal(
    result.turns.filter((turn) => turn.status === 'measured').length,
    9,
  );
});

test('a crossing onset invalidates its own VAD window without blocking later independent windows', () => {
  const sampleRate = 48_000;
  const frames = sampleRate * 90;
  const speechSegments = [
    { startSample: 100_000, endSample: 120_000 },
    { startSample: 300_000, endSample: 320_000 },
    { startSample: 500_000, endSample: 520_000 },
    { startSample: 700_000, endSample: 720_000 },
  ];
  const assistantPcm16 = silentPcm16(frames);
  addAssistantBurst(assistantPcm16, 200_000, 200_600);
  addAssistantBurst(assistantPcm16, 400_000, 500_100);
  addAssistantBurst(assistantPcm16, 800_000, 800_600);
  const result = computeAudioTimelineMeasurement({
    inputPcm16: silentPcm16(frames),
    inputChannels: 1,
    assistantPcm16,
    assistantChannels: 1,
    sampleRate,
    speechSegments,
    missingBlocks: 0,
  });

  assert.deepEqual(
    result.turns.map((turn) => turn.status),
    ['measured', 'unsupported', 'unsupported', 'measured'],
  );
  assert.match(
    result.turns[1]?.reason ?? '',
    /overlaps the next human VAD turn/,
  );
  assert.equal(result.turns[3]?.assistantOnsetSample, 800_000);
});

test('leaves later independently bounded VAD windows unsupported when no assistant onset exists', () => {
  const sampleRate = 48_000;
  const frames = sampleRate * 90;
  const speechSegments = [
    { startSample: 100_000, endSample: 120_000 },
    { startSample: 300_000, endSample: 320_000 },
    { startSample: 500_000, endSample: 520_000 },
  ];
  const assistantPcm16 = silentPcm16(frames);
  addAssistantBurst(assistantPcm16, 200_000, 200_600);
  const result = computeAudioTimelineMeasurement({
    inputPcm16: silentPcm16(frames),
    inputChannels: 1,
    assistantPcm16,
    assistantChannels: 1,
    sampleRate,
    speechSegments,
    missingBlocks: 0,
  });

  assert.deepEqual(
    result.turns.map((turn) => turn.status),
    ['measured', 'unsupported', 'unsupported'],
  );
  assert.ok(
    result.turns.slice(1).every((turn) => turn.latencySamples === null),
  );
});

test('treats three raw VAD islands from one single-turn playback as one command envelope', () => {
  const rawSegments = [
    { startSample: 100, endSample: 150 },
    { startSample: 800, endSample: 850 },
    { startSample: 1_500, endSample: 1_600 },
  ];
  assert.deepEqual(singleCommandSpeechEnvelope(rawSegments), [
    { startSample: 100, endSample: 1_600 },
  ]);
});

test('measures single-command latency from the final raw VAD end', () => {
  const rawSegments = [
    { startSample: 100, endSample: 150 },
    { startSample: 800, endSample: 850 },
    { startSample: 1_500, endSample: 1_600 },
  ];
  const assistant = silentPcm16(2_000);
  addAssistantBurst(assistant, 1_700, 1_730);
  const [command] = singleCommandSpeechEnvelope(rawSegments);
  assert.ok(command);
  const result = computeAudioTimelineMeasurement({
    inputPcm16: silentPcm16(2_000),
    inputChannels: 1,
    assistantPcm16: assistant,
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [command],
    missingBlocks: 0,
  });
  assert.equal(result.status, 'measured');
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]?.vadEndSample, 1_600);
  assert.equal(result.turns[0]?.latencySamples, 100);
});

test('rejects assistant activity before the command starts only in single-turn diagnostics', () => {
  const assistant = silentPcm16(2_000);
  addAssistantBurst(assistant, 20, 50);
  addAssistantBurst(assistant, 1_700, 1_730);
  const [command] = singleCommandSpeechEnvelope([
    { startSample: 100, endSample: 150 },
    { startSample: 800, endSample: 850 },
    { startSample: 1_500, endSample: 1_600 },
  ]);
  assert.ok(command);
  const args = {
    inputPcm16: silentPcm16(2_000),
    inputChannels: 1,
    assistantPcm16: assistant,
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [command],
    missingBlocks: 0,
  };

  const ordinaryMeasurement = computeAudioTimelineMeasurement(args);
  assert.equal(ordinaryMeasurement.status, 'measured');
  assert.equal(ordinaryMeasurement.turns[0]?.latencySamples, 100);

  const singleTurnMeasurement = computeAudioTimelineMeasurement({
    ...args,
    rejectAssistantOnsetBeforeSpeechEnd: true,
  });
  assert.equal(singleTurnMeasurement.status, 'unsupported');
  assert.equal(singleTurnMeasurement.turns[0]?.latencySamples, null);
  assert.match(
    singleTurnMeasurement.turns[0]?.reason ?? '',
    /began before the human command speech ended/,
  );
});

test('does not measure a single-command onset in a VAD island gap before final end', () => {
  const rawSegments = [
    { startSample: 100, endSample: 150 },
    { startSample: 800, endSample: 850 },
    { startSample: 1_500, endSample: 1_600 },
  ];
  const assistant = silentPcm16(2_000);
  addAssistantBurst(assistant, 1_200, 1_230);
  const [command] = singleCommandSpeechEnvelope(rawSegments);
  assert.ok(command);
  const result = computeAudioTimelineMeasurement({
    inputPcm16: silentPcm16(2_000),
    inputChannels: 1,
    assistantPcm16: assistant,
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [command],
    missingBlocks: 0,
  });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.turns[0]?.latencySamples, null);
  assert.match(result.turns[0]?.reason ?? '', /overlapped/);
});

test('merges short VAD pauses into a human turn without losing sample offsets', () => {
  assert.deepEqual(
    mergeHumanSpeechSegments(
      [
        { startSample: 100, endSample: 200 },
        { startSample: 500, endSample: 600 },
        { startSample: 1_101, endSample: 1_200 },
      ],
      1_000,
    ),
    [
      { startSample: 100, endSample: 600 },
      { startSample: 1_101, endSample: 1_200 },
    ],
  );
});

test('preserves full-session offsets and bounds assistant events to each human turn', () => {
  const { input, assistant } = fixture();
  const result = computeAudioTimelineMeasurement({
    inputPcm16: pcm16(input),
    inputChannels: 1,
    assistantPcm16: pcm16(assistant),
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [
      { startSample: 96, endSample: 180 },
      { startSample: 280, endSample: 350 },
    ],
    missingBlocks: 0,
  });
  assert.equal(result.status, 'measured');
  assert.equal(result.turns.length, 2);
  assert.equal(result.turns[0]?.latencySamples, 40);
  assert.equal(result.turns[1]?.latencySamples, 30);
  assert.equal(result.turns[1]?.vadEndOffsetFromT0Samples, 254);
  assert.equal(result.turns[1]?.assistantOnsetOffsetFromT0Samples, 284);
});

test('does not associate a later assistant burst after audio overlapped the human turn', () => {
  const { input } = fixture();
  const assistant = new Array<number>(500).fill(0);
  for (let i = 150; i < 180; i++) assistant[i] = 11_000;
  for (let i = 220; i < 250; i++) assistant[i] = 11_000;
  const result = computeAudioTimelineMeasurement({
    inputPcm16: pcm16(input),
    inputChannels: 1,
    assistantPcm16: pcm16(assistant),
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [{ startSample: 100, endSample: 200 }],
    missingBlocks: 0,
  });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.turns[0]?.latencySamples, null);
  assert.match(result.turns[0]?.reason ?? '', /overlapped/);
});

test('marks an already-active assistant output at the VAD endpoint ambiguous', () => {
  const { input } = fixture();
  const assistant = new Array<number>(500).fill(0);
  for (let i = 150; i < 230; i++) assistant[i] = 11_000;
  const result = computeAudioTimelineMeasurement({
    inputPcm16: pcm16(input),
    inputChannels: 1,
    assistantPcm16: pcm16(assistant),
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [{ startSample: 96, endSample: 180 }],
    missingBlocks: 0,
  });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.turns[0]?.assistantOnsetSample, null);
  assert.match(result.turns[0]?.reason ?? '', /overlapped/);
});

test('does not reuse an assistant onset after a later human turn begins', () => {
  const { input } = fixture();
  const assistant = new Array<number>(500).fill(0);
  for (let i = 320; i < 350; i++) assistant[i] = 11_000;
  const result = computeAudioTimelineMeasurement({
    inputPcm16: pcm16(input),
    inputChannels: 1,
    assistantPcm16: pcm16(assistant),
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [
      { startSample: 96, endSample: 180 },
      { startSample: 280, endSample: 350 },
    ],
    missingBlocks: 0,
  });
  assert.equal(result.status, 'unsupported');
  assert.equal(result.turns[0]?.latencySamples, null);
  assert.equal(result.turns[1]?.latencySamples, null);
});

test('keeps channel-interleaved offsets and refuses missing capture blocks', () => {
  const { input, assistant } = fixture();
  const result = computeAudioTimelineMeasurement({
    inputPcm16: pcm16(
      input.flatMap((sample) => [sample, sample]),
      2,
    ),
    inputChannels: 2,
    assistantPcm16: pcm16(
      assistant.flatMap((sample) => [0, sample]),
      2,
    ),
    assistantChannels: 2,
    sampleRate: 1_000,
    speechSegments: [{ startSample: 96, endSample: 180 }],
    missingBlocks: 1,
  });
  assert.equal(result.status, 'unsupported');
  assert.match(result.reason ?? '', /missing blocks/);
});

test('summarizes only supported response latencies', () => {
  const responseLatency = {
    status: 'partial' as const,
    t0Sample: 20,
    turns: [
      {
        status: 'measured' as const,
        vadStartSample: 20,
        vadEndSample: 100,
        vadEndOffsetFromT0Samples: 80,
        assistantOnsetSample: 200,
        assistantOnsetOffsetFromT0Samples: 180,
        latencySamples: 100,
        latencyMs: 100,
      },
      {
        status: 'unsupported' as const,
        vadStartSample: 250,
        vadEndSample: 300,
        vadEndOffsetFromT0Samples: 280,
        assistantOnsetSample: null,
        assistantOnsetOffsetFromT0Samples: null,
        latencySamples: null,
        latencyMs: null,
        reason: 'overlapping output',
      },
    ],
  };
  const summary = summarizeVoiceBenchmark([], responseLatency);
  assert.deepEqual(summary.responseLatencyMs, {
    sampleCount: 1,
    median: 100,
    p95: 100,
  });
  assert.match(summary.unsupported.responseLatency ?? '', /overlapping output/);
});

test('does not invent a latency when there is no human VAD input or assistant onset', () => {
  const silence = pcm16(new Array<number>(500).fill(0));
  const { input } = fixture();
  const noInput = computeAudioTimelineMeasurement({
    inputPcm16: silence,
    inputChannels: 1,
    assistantPcm16: silence,
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [],
    missingBlocks: 0,
  });
  assert.equal(noInput.status, 'unsupported');
  assert.match(noInput.reason ?? '', /No human VAD segments/);

  const noReply = computeAudioTimelineMeasurement({
    inputPcm16: pcm16(input),
    inputChannels: 1,
    assistantPcm16: silence,
    assistantChannels: 1,
    sampleRate: 1_000,
    speechSegments: [{ startSample: 96, endSample: 180 }],
    missingBlocks: 0,
  });
  assert.equal(noReply.status, 'unsupported');
  assert.equal(noReply.turns[0]?.latencySamples, null);
});
