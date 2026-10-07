import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nonSilentMs, replyWav, silentTailMs } from './reply-recorder';

function frame(active: boolean): Buffer {
  const buffer = Buffer.alloc(480 * 2);
  if (active) {
    for (let offset = 0; offset < buffer.length; offset += 2)
      buffer.writeInt16LE(4096, offset);
  }
  return buffer;
}

test('measures non-silent audio and its explicit quiet tail', () => {
  const samples = Buffer.concat([
    frame(false),
    frame(true),
    frame(true),
    frame(false),
    frame(false),
  ]);
  assert.equal(nonSilentMs(samples), 20);
  assert.equal(silentTailMs(samples), 20);
  assert.equal(silentTailMs(samples.subarray(0, 3 * 960)), 0);
});

test('wraps only the selected per-turn PCM slice in a WAV container', () => {
  const all = Buffer.concat([frame(true), frame(false), frame(true)]);
  const firstTurn = replyWav(all.subarray(0, 2 * 960));
  assert.equal(firstTurn.readUInt32LE(40), 2 * 960);
  assert.equal(firstTurn.length, 44 + 2 * 960);
  assert.equal(firstTurn.toString('ascii', 0, 4), 'RIFF');
});
