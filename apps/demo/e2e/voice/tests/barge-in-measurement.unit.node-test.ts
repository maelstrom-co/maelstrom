import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeBargeInMeasurement,
  invalidBargeIn,
  summarizeBargeIn,
} from './barge-in-measurement.ts';
import type { BargeInPlaybackEvent } from './barge-in-observer.ts';

function fixture(channels = 1) {
  const pcm = Buffer.alloc(5_000 * 2 * channels);
  for (let frame = 0; frame < 1_000; frame++)
    pcm.writeInt16LE(12_000, (frame * channels + channels - 1) * 2);
  return {
    assistantPcm16: pcm,
    assistantChannels: channels,
    sampleRate: 1_000,
    humanOnsetSample: 800,
    missingBlocks: 0,
    targetResponseId: 'r1',
    events: [
      {
        type: 'output_audio_buffer.cleared',
        frame: 1_020,
        responseId: 'r1',
        status: null,
      },
    ] as BargeInPlaybackEvent[],
    droppedEvents: 0,
  };
}

test('measures speech onset to the beginning, not confirmation end, of silence', () => {
  assert.deepEqual(computeBargeInMeasurement(fixture()), {
    status: 'measured',
    humanOnsetSample: 800,
    assistantStopSample: 1_000,
    latencyMs: 200,
    reason: null,
  });
  assert.equal(computeBargeInMeasurement(fixture(2)).latencyMs, 200);
});

test('ignores speech pauses shorter than the silence confirmation', () => {
  const args = fixture();
  args.assistantPcm16.fill(0, 860 * 2, 950 * 2);
  assert.equal(computeBargeInMeasurement(args).latencyMs, 200);
});

test('rejects nonoverlapping interruption and unsupported capture clocks', () => {
  assert.equal(
    computeBargeInMeasurement({ ...fixture(), humanOnsetSample: 1_200 }).status,
    'invalid',
  );
  for (const change of [
    { missingBlocks: 1 },
    { droppedEvents: 1 },
    { humanOnsetSample: -1 },
    { humanOnsetSample: 8_000 },
    { sampleRate: 0 },
    { assistantChannels: 0 },
    { assistantPcm16: Buffer.alloc(3) },
    { humanOnsetSample: 50 },
  ])
    assert.equal(
      computeBargeInMeasurement({ ...fixture(), ...change }).status,
      'invalid',
    );
});

test('keeps natural completion, missing attribution and unrelated cancellation ambiguous', () => {
  for (const events of [
    [],
    [
      {
        type: 'response.done',
        responseId: 'r1',
        frame: 1_010,
        status: 'completed',
      },
    ],
    [
      {
        type: 'response.done',
        responseId: 'other',
        frame: 1_010,
        status: 'cancelled',
      },
    ],
    [
      {
        type: 'output_audio_buffer.cleared',
        responseId: 'r1',
        frame: 700,
        status: null,
      },
    ],
    [
      {
        type: 'output_audio_buffer.cleared',
        responseId: 'r1',
        frame: 2_000,
        status: null,
      },
    ],
  ] as BargeInPlaybackEvent[][]) {
    const result = computeBargeInMeasurement({ ...fixture(), events });
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.latencyMs, null);
  }
  assert.equal(
    computeBargeInMeasurement({ ...fixture(), targetResponseId: null }).status,
    'ambiguous',
  );
});

test('completed generation before onset does not invalidate a subsequently cleared playback', () => {
  const args = fixture();
  args.events.unshift({
    type: 'response.done',
    responseId: 'r1',
    frame: 600,
    status: 'completed',
  });
  assert.equal(computeBargeInMeasurement(args).status, 'measured');
  assert.equal(
    computeBargeInMeasurement({
      ...fixture(),
      events: [
        {
          type: 'response.done',
          responseId: 'r1',
          frame: 820,
          status: 'cancelled',
        },
      ],
    }).status,
    'measured',
  );
});

test('reports an assistant that keeps speaking as a timeout, not a percentile sample', () => {
  const args = fixture();
  for (let frame = 1_000; frame < 5_000; frame++)
    args.assistantPcm16.writeInt16LE(12_000, frame * 2);
  const result = computeBargeInMeasurement(args);
  assert.equal(result.status, 'timeout');
  assert.equal(result.latencyMs, null);
});

test('incomplete capture is invalid, not a timeout', () => {
  const args = fixture();
  for (const frames of [1_100, 1_500])
    assert.equal(
      computeBargeInMeasurement({
        ...args,
        assistantPcm16: args.assistantPcm16.subarray(0, frames * 2),
      }).status,
      'invalid',
    );
});

test('incomplete guard is invalid even with competing output or missing cancellation', () => {
  const args = fixture();
  for (const events of [
    [],
    [
      ...args.events,
      {
        type: 'output_audio_buffer.started' as const,
        frame: 1_100,
        responseId: 'r2',
        status: null,
      },
    ],
  ]) {
    const result = computeBargeInMeasurement({
      ...args,
      assistantPcm16: args.assistantPcm16.subarray(0, 1_500 * 2),
      events,
    });
    assert.equal(result.status, 'invalid');
    assert.equal(result.latencyMs, null);
  }
});

test('resumed interrupted output fails unless new or unidentified output makes attribution ambiguous', () => {
  const args = fixture();
  for (let frame = 1_400; frame < 1_600; frame++)
    args.assistantPcm16.writeInt16LE(12_000, frame * 2);
  assert.equal(computeBargeInMeasurement(args).status, 'failed');
  for (const responseId of ['r2', null]) {
    for (const frame of [1_400, 1_450, 5_100]) {
      const result = computeBargeInMeasurement({
        ...args,
        events: [
          ...args.events,
          {
            type: 'output_audio_buffer.started',
            frame,
            responseId,
            status: null,
          },
        ],
      });
      assert.equal(result.status, 'ambiguous');
      assert.equal(result.latencyMs, null);
    }
  }
});

test('silence already in progress at human onset is not a zero-latency success', () => {
  const result = computeBargeInMeasurement({
    ...fixture(),
    humanOnsetSample: 1_010,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.assistantStopSample, 1_000);
  assert.equal(result.latencyMs, null);
});

test('a future lifecycle event cannot excuse an uncaptured resumption guard', () => {
  const args = fixture();
  args.events.push({
    type: 'output_audio_buffer.started',
    frame: 2_000,
    responseId: 'r2',
    status: null,
  });
  const result = computeBargeInMeasurement({
    ...args,
    assistantPcm16: args.assistantPcm16.subarray(0, 1_500 * 2),
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.latencyMs, null);
});

test('a new response before silence confirmation makes the boundary ambiguous', () => {
  const args = fixture();
  args.events.push({
    type: 'output_audio_buffer.started',
    frame: 1_100,
    responseId: 'r2',
    status: null,
  });
  assert.equal(computeBargeInMeasurement(args).status, 'ambiguous');
});

test('invalid measurements retain the actual detected onset instead of discarding evidence', () => {
  const result = computeBargeInMeasurement({
    ...fixture(),
    humanOnsetSample: 1_200,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.humanOnsetSample, 1_200);
  assert.equal(result.latencyMs, null);
  assert.equal(invalidBargeIn('bad clock', Number.NaN).humanOnsetSample, null);
});

test('local greeting stop corroborates captured silence without remote response IDs', () => {
  const args = { ...fixture(), targetResponseId: null, events: [] };
  const greetingPlayback = {
    sourceCount: 1,
    failure: null,
    stoppedAtSample: 1_010,
    stoppedEarly: true,
  };
  assert.equal(
    computeBargeInMeasurement({ ...args, greetingPlayback }).status,
    'measured',
  );
  for (const change of [
    { stoppedEarly: false },
    { stoppedAtSample: null },
    { stoppedAtSample: 700 },
  ])
    assert.equal(
      computeBargeInMeasurement({
        ...args,
        greetingPlayback: { ...greetingPlayback, ...change },
      }).status,
      'ambiguous',
    );
  for (const change of [
    { sourceCount: 0 },
    { sourceCount: 2 },
    { failure: 'unarmed-capture' },
  ])
    assert.equal(
      computeBargeInMeasurement({
        ...args,
        greetingPlayback: { ...greetingPlayback, ...change },
      }).status,
      'invalid',
    );
});

test('natural completion is ambiguous with clean PCM and invalid with a reported gap, never measured', () => {
  const greetingPlayback = {
    sourceCount: 1,
    failure: null,
    stoppedAtSample: 1_010,
    stoppedEarly: false,
  };
  const clean = computeBargeInMeasurement({ ...fixture(), greetingPlayback });
  const gap = computeBargeInMeasurement({
    ...fixture(),
    greetingPlayback,
    missingBlocks: 1,
  });
  assert.equal(clean.status, 'ambiguous');
  assert.equal(
    clean.reason,
    'Output became quiet without matching interruption evidence; natural completion cannot be excluded.',
  );
  assert.equal(gap.status, 'invalid');
  assert.equal(
    gap.reason,
    'Incomplete shared-clock capture or playback evidence.',
  );
  assert.equal(clean.latencyMs, null);
  assert.equal(gap.latencyMs, null);
  assert.equal(gap.humanOnsetSample, 800);
});

test('summarizes conditional latency with explicit attempt and failure denominators', () => {
  const measured = computeBargeInMeasurement(fixture());
  const summary = summarizeBargeIn([
    measured,
    { ...measured, latencyMs: 400 },
    { ...measured, status: 'timeout', latencyMs: null },
    { ...measured, status: 'failed', latencyMs: null },
    { ...measured, status: 'ambiguous', latencyMs: null },
    invalidBargeIn('capture'),
  ]);
  assert.equal(summary.attemptCount, 6);
  assert.deepEqual(summary.counts, {
    measured: 2,
    invalid: 1,
    ambiguous: 1,
    timeout: 1,
    failed: 1,
  });
  assert.equal(summary.validAttemptCount, 4);
  assert.equal(summary.failureRate, 0.5);
  assert.deepEqual(summary.latencyMs, {
    sampleCount: 2,
    median: 300,
    p95: 400,
    population: 'successfully measured stops only',
  });
  assert.equal(summarizeBargeIn([]).latencyMs.median, null);
  assert.equal(summarizeBargeIn([invalidBargeIn('capture')]).failureRate, null);
});
