import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getPcm16WavMetadata,
  parseCompletedPlayback,
  serializePlaybackObservation,
} from './playback-observability.ts';

function pcm16Wav({
  channels = 2,
  sampleRate = 16_000,
  frames = 80,
}: {
  channels?: number;
  sampleRate?: number;
  frames?: number;
} = {}): Buffer {
  const dataLength = channels * frames * 2;
  const wav = Buffer.alloc(44 + dataLength);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataLength, 40);
  return wav;
}

test('reports only PCM16 WAV sample rate, frame count, channels, and duration metadata', () => {
  const metadata = getPcm16WavMetadata(pcm16Wav());
  assert.deepEqual(metadata, {
    sampleRate: 16_000,
    channels: 2,
    frameCount: 80,
    durationMs: 5,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), metadata);
});

test('serializes only fixture and completed-playback timing metadata', () => {
  const fixture = getPcm16WavMetadata(pcm16Wav());
  const observation = serializePlaybackObservation(
    fixture,
    parseCompletedPlayback('{"status":"completed","stdout":"private"}'),
    123.5,
    10_000,
    11_280,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(observation)), {
    fixture: {
      sampleRate: 16_000,
      channels: 2,
      frameCount: 80,
      durationMs: 5,
    },
    playback: {
      status: 'completed',
      elapsedMs: 123.5,
      workletStartFrame: 10_000,
      workletEndFrame: 11_280,
    },
  });
  assert.equal(JSON.stringify(observation).includes('private'), false);
});

test('rejects invalid playback timing metadata', () => {
  const fixture = getPcm16WavMetadata(pcm16Wav());
  assert.throws(
    () =>
      serializePlaybackObservation(
        fixture,
        { status: 'completed' },
        -1,
        100,
        200,
      ),
    /invalid timing metadata/,
  );
});

test('rejects malformed, truncated, and non-PCM16 fixture WAVs', () => {
  assert.throws(() =>
    getPcm16WavMetadata(Buffer.from('private fixture audio')),
  );
  const truncated = pcm16Wav();
  truncated.writeUInt32LE(truncated.length, 40);
  assert.throws(() => getPcm16WavMetadata(truncated), /truncated WAV chunk/);
  const unsupported = pcm16Wav();
  unsupported.writeUInt16LE(3, 20);
  assert.throws(() => getPcm16WavMetadata(unsupported), /PCM16/);
});

test('parses a completed playback result into a status-only record', () => {
  assert.deepEqual(
    parseCompletedPlayback('{"status":"completed","text":"private"}'),
    {
      status: 'completed',
    },
  );
});

test('rejects malformed or incomplete playback results without echoing stdout', () => {
  for (const stdout of [
    'not-json-private',
    '{"status":"failed","detail":"private"}',
    '{}',
  ]) {
    assert.throws(
      () => parseCompletedPlayback(stdout),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          'Audio playback did not report completed status',
        );
        assert.equal(error.message.includes('private'), false);
        return true;
      },
    );
  }
});
