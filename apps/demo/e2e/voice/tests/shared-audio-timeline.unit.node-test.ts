import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeVoiceBenchmark } from './benchmark-metrics.ts';
import {
  computeAudioTimelineMeasurement,
  mergeHumanSpeechSegments,
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
