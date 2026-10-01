import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionAudioArtifacts } from './session-audio-artifacts.ts';
import type { BrowserAudioTimelineSnapshot } from './shared-audio-capture.ts';

function wav(frames: number, sampleRate: number): string {
  const body = Buffer.alloc(44 + frames * 2);
  body.write('RIFF', 0);
  body.writeUInt32LE(body.length - 8, 4);
  body.write('WAVEfmt ', 8);
  body.writeUInt32LE(16, 16);
  body.writeUInt16LE(1, 20);
  body.writeUInt16LE(1, 22);
  body.writeUInt32LE(sampleRate, 24);
  body.writeUInt32LE(sampleRate * 2, 28);
  body.writeUInt16LE(2, 32);
  body.writeUInt16LE(16, 34);
  body.write('data', 36);
  body.writeUInt32LE(frames * 2, 40);
  return body.toString('base64');
}

function snapshot(overrides: Partial<BrowserAudioTimelineSnapshot> = {}) {
  return {
    sampleRate: 48_000,
    inputChannels: 1,
    assistantChannels: 1,
    startFrame: 120,
    endFrame: 4_920,
    blockCount: 2,
    missingBlocks: 0,
    missingBlockReasons: {
      frameGaps: 0,
      inputFormatChanges: 0,
      assistantFormatChanges: 0,
      inputAbsentBlocks: 0,
      assistantAbsentBlocks: 0,
      frameGapDetails: [],
    },
    inputWavBase64: wav(4_800, 48_000),
    assistantWavBase64: wav(4_800, 48_000),
    ...overrides,
  } satisfies BrowserAudioTimelineSnapshot;
}

test('ordinary session produces only two aligned complete-session WAV artifacts', () => {
  const artifacts = sessionAudioArtifacts(snapshot());
  assert.deepEqual(
    artifacts.map(({ name }) => name),
    [
      'voice-session-human-input-audioworklet.wav',
      'voice-session-assistant-rendered-audioworklet.wav',
    ],
  );
  assert.equal(artifacts.length, 2);
  const decoded = artifacts.map(({ body }) => ({
    rate: body.readUInt32LE(24),
    frames: body.readUInt32LE(40) / (body.readUInt16LE(22) * 2),
  }));
  assert.deepEqual(decoded, [
    { rate: 48_000, frames: 4_800 },
    { rate: 48_000, frames: 4_800 },
  ]);
  for (const { frames, rate } of decoded) assert.equal(frames / rate, 0.1);
});

test('does not produce audio artifacts for incomplete or misaligned captures', () => {
  assert.throws(
    () => sessionAudioArtifacts(snapshot({ missingBlocks: 1 })),
    /missing or format-changing blocks/,
  );
  assert.throws(
    () =>
      sessionAudioArtifacts(
        snapshot({ assistantWavBase64: wav(4_799, 48_000) }),
      ),
    /do not share the captured sample rate and frame timeline/,
  );
  assert.throws(
    () => sessionAudioArtifacts(snapshot({ sampleRate: 44_100 })),
    /do not share the captured sample rate and frame timeline/,
  );
});
