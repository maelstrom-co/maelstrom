import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  type BargeInStimulus,
  prepareBargeInStimulus,
} from './barge-in-stimulus.ts';
import { getPcm16WavMetadata } from './playback-observability.ts';
import type { VadValidation } from './single-turn-validity.ts';
import { trimPcm16Wav } from './trim-pcm16-wav.ts';

function chunk(id: string, payload: Buffer) {
  const result = Buffer.alloc(8 + payload.length + (payload.length % 2));
  result.write(id, 0);
  result.writeUInt32LE(payload.length, 4);
  payload.copy(result, 8);
  if (payload.length % 2) result[result.length - 1] = 0x7f;
  return result;
}

function riff(chunks: readonly Buffer[]) {
  const result = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE'), ...chunks]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

function fixture(channels = 2, frames = 80) {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(channels, 2);
  format.writeUInt32LE(16_000, 4);
  format.writeUInt32LE(16_000 * channels * 2, 8);
  format.writeUInt16LE(channels * 2, 12);
  format.writeUInt16LE(16, 14);
  const pcm = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames * channels; i++) pcm.writeInt16LE(i - 40, i * 2);
  return {
    format,
    pcm,
    wav: riff([chunk('fmt ', format), chunk('data', pcm)]),
  };
}

function data(wav: Buffer): Buffer {
  for (let offset = 12; offset < wav.length; ) {
    const length = wav.readUInt32LE(offset + 4);
    if (wav.toString('latin1', offset, offset + 4) === 'data')
      return wav.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  throw new Error('Missing data chunk');
}

const vad: VadValidation = {
  valid: true,
  reason: null,
  sampleRate: 16_000,
  channels: 2,
  segments: [{ startSample: 16, endSample: 60 }],
};

test('PCM16 prefix trimming cuts source frames for mono/stereo without changing remaining PCM or the source', () => {
  for (const channels of [1, 2]) {
    const source = fixture(channels);
    const original = Buffer.from(source.wav);
    const trimmed = trimPcm16Wav(source.wav, 16);
    assert.deepEqual(data(trimmed), source.pcm.subarray(16 * channels * 2));
    assert.deepEqual(source.wav, original);
    assert.deepEqual(getPcm16WavMetadata(trimmed), {
      sampleRate: 16_000,
      channels,
      frameCount: 64,
      durationMs: 4,
    });
    assert.equal(trimmed.readUInt32LE(4), trimmed.length - 8);
    assert.deepEqual(trimPcm16Wav(trimmed, 0), trimmed);
    const zeroCut = trimPcm16Wav(source.wav, 0);
    assert.deepEqual(zeroCut, source.wav);
    assert.notEqual(zeroCut, source.wav);
  }
});

test('PCM16 prefix trimming preserves noncanonical chunk order, INFO/JUNK/PAD content, and odd-byte padding', () => {
  const source = fixture();
  const before = chunk('JUNK', Buffer.from([1, 2, 3]));
  const info = chunk(
    'LIST',
    Buffer.concat([Buffer.from('INFO'), chunk('INAM', Buffer.from('title'))]),
  );
  const after = chunk('PAD ', Buffer.from([4, 5, 6]));
  const wav = riff([
    before,
    chunk('data', source.pcm),
    info,
    chunk('fmt ', source.format),
    after,
  ]);
  const result = trimPcm16Wav(wav, 8);
  assert.deepEqual(
    result,
    riff([
      before,
      chunk('data', source.pcm.subarray(32)),
      info,
      chunk('fmt ', source.format),
      after,
    ]),
  );
  assert.equal(getPcm16WavMetadata(result).frameCount, 72);
  assert.deepEqual(trimPcm16Wav(result, 0), result);
});

test('PCM16 prefix trimming accepts an empty PCM format extension but rejects unsupported encodings and layout', () => {
  const source = fixture();
  const extended = Buffer.concat([source.format, Buffer.alloc(2)]);
  assert.equal(
    getPcm16WavMetadata(
      trimPcm16Wav(
        riff([chunk('fmt ', extended), chunk('data', source.pcm)]),
        1,
      ),
    ).frameCount,
    79,
  );
  for (const [offset, value] of [
    [0, 3],
    [0, 0xfffe],
    [2, 0],
    [12, 2],
    [14, 8],
  ]) {
    const format = Buffer.from(source.format);
    format.writeUInt16LE(value, offset);
    assert.throws(() =>
      trimPcm16Wav(riff([chunk('fmt ', format), chunk('data', source.pcm)]), 0),
    );
  }
  for (const [offset, value] of [
    [4, 0],
    [8, 1],
  ]) {
    const format = Buffer.from(source.format);
    format.writeUInt32LE(value, offset);
    assert.throws(() =>
      trimPcm16Wav(riff([chunk('fmt ', format), chunk('data', source.pcm)]), 0),
    );
  }
  extended.writeUInt16LE(1, 16);
  assert.throws(() =>
    trimPcm16Wav(riff([chunk('fmt ', extended), chunk('data', source.pcm)]), 0),
  );
  for (const length of [0, 15, 17, 20])
    assert.throws(() =>
      trimPcm16Wav(
        riff([chunk('fmt ', Buffer.alloc(length)), chunk('data', source.pcm)]),
        0,
      ),
    );
});

test('PCM16 prefix trimming rejects invalid cuts, empty PCM, and partial frames', () => {
  const source = fixture();
  for (const cut of [-1, 0.5, NaN, Infinity, 80, 81, Number.MAX_SAFE_INTEGER])
    assert.throws(() => trimPcm16Wav(source.wav, cut), /cut frame/);
  assert.equal(getPcm16WavMetadata(trimPcm16Wav(source.wav, 79)).frameCount, 1);
  for (const length of [0, 1, 2, 3])
    assert.throws(
      () =>
        trimPcm16Wav(
          riff([
            chunk('fmt ', source.format),
            chunk('data', Buffer.alloc(length)),
          ]),
          0,
        ),
      /complete nonempty frames/,
    );
});

test('PCM16 prefix trimming rejects duplicate/missing chunks and unsupported sample-position metadata', () => {
  const source = fixture();
  const fmt = chunk('fmt ', source.format);
  const pcm = chunk('data', source.pcm);
  for (const chunks of [[], [fmt], [pcm], [fmt, fmt, pcm], [fmt, pcm, pcm]])
    assert.throws(() => trimPcm16Wav(riff(chunks), 0));
  for (const id of ['cue ', 'smpl', 'fact', 'bext', 'iXML', 'wavl'])
    assert.throws(
      () => trimPcm16Wav(riff([fmt, chunk(id, Buffer.alloc(0)), pcm]), 0),
      /Unsupported WAV chunk/,
    );
  assert.throws(
    () => trimPcm16Wav(riff([fmt, chunk('LIST', Buffer.from('adtl')), pcm]), 0),
    /LIST\/INFO/,
  );
});

test('PCM16 prefix trimming fails on malformed RIFF boundaries, chunks, and padding', () => {
  const source = fixture();
  const malformed = [
    Buffer.alloc(0),
    Buffer.from('not a WAV file'),
    source.wav.subarray(0, -1),
    Buffer.concat([source.wav, Buffer.from([0])]),
  ];
  for (const size of [
    0,
    source.wav.length - 9,
    source.wav.length,
    0xffffffff,
  ]) {
    const wav = Buffer.from(source.wav);
    wav.writeUInt32LE(size, 4);
    malformed.push(wav);
  }
  const overrun = Buffer.from(source.wav);
  overrun.writeUInt32LE(source.wav.length, 40);
  malformed.push(overrun);
  const fmt = chunk('fmt ', source.format);
  const pcm = chunk('data', source.pcm);
  malformed.push(riff([fmt, pcm, Buffer.alloc(7)]));
  malformed.push(
    riff([fmt, pcm, chunk('JUNK', Buffer.from([1])).subarray(0, -1)]),
  );
  malformed.push(riff([fmt, chunk('LIST', Buffer.from('INFOx')), pcm]));
  malformed.push(
    riff([
      fmt,
      chunk(
        'LIST',
        Buffer.concat([
          Buffer.from('INFO'),
          chunk('INAM', Buffer.from('x')).subarray(0, -1),
        ]),
      ),
      pcm,
    ]),
  );
  const badMagic = Buffer.from(source.wav);
  badMagic[0] = 0xd2;
  malformed.push(badMagic);
  for (const wav of malformed) assert.throws(() => trimPcm16Wav(wav, 0));
});

test('both interruption lanes use private temporary suffixes and retain original source evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'barge-in-stimulus-test-'));
  const source = fixture();
  const original = Buffer.from(source.wav);
  const originalVad = structuredClone(vad);
  const sourceHash = createHash('sha256').update(original).digest('hex');
  const sourcePath = join(root, 'open-calendar.wav');
  const prepared: BargeInStimulus[] = [];
  await writeFile(sourcePath, original);
  try {
    for (const scenario of ['greeting', 'task-response'] as const) {
      const stimulus = await prepareBargeInStimulus({
        scenario,
        sourceWav: source.wav,
        fixtureVad: vad,
      });
      prepared.push(stimulus);
      assert.notEqual(stimulus.path, sourcePath);
      const played = await readFile(stimulus.path);
      assert.deepEqual(played, stimulus.wav);
      assert.deepEqual(data(played), source.pcm.subarray(64));
      assert.equal((await stat(stimulus.path)).mode & 0o777, 0o600);
      assert.equal((await stat(dirname(stimulus.path))).mode & 0o777, 0o700);
      assert.deepEqual(stimulus.metadata, getPcm16WavMetadata(played));
      assert.deepEqual(stimulus.evidence, {
        sampleRate: 16_000,
        channels: 2,
        frameCount: 64,
        durationMs: 4,
        sha256: createHash('sha256').update(played).digest('hex'),
        transformation: 'prefix-before-first-source-vad-segment',
        trimmedFrames: 16,
        trimmedMs: 1,
      });
      assert.notEqual(stimulus.evidence.sha256, sourceHash);
      assert.deepEqual(source.wav, original);
      assert.deepEqual(await readFile(sourcePath), original);
      assert.deepEqual(vad, originalVad);
    }
    assert.notEqual(prepared[0]?.path, prepared[1]?.path);
    for (const stimulus of prepared) {
      await stimulus.cleanup();
      await assert.rejects(access(dirname(stimulus.path)), { code: 'ENOENT' });
      await stimulus.cleanup();
    }
    assert.deepEqual(await readFile(sourcePath), original);
  } finally {
    for (const stimulus of prepared) await stimulus.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

for (const scenario of ['greeting', 'task-response'] as const) {
  test(`${scenario} preparation requires matching validated source VAD and accepts speech starting at frame zero`, async () => {
    const source = fixture();
    for (const fixtureVad of [
      { ...vad, valid: false },
      { ...vad, sampleRate: 48_000 },
      { ...vad, channels: 1 },
      { ...vad, segments: [] },
      { ...vad, segments: [{ startSample: 80, endSample: 81 }] },
    ])
      await assert.rejects(
        prepareBargeInStimulus({
          scenario,
          sourceWav: source.wav,
          fixtureVad,
        }),
      );
    const prepared = await prepareBargeInStimulus({
      scenario,
      sourceWav: source.wav,
      fixtureVad: { ...vad, segments: [{ startSample: 0, endSample: 60 }] },
    });
    try {
      assert.equal(prepared.evidence.trimmedFrames, 0);
      assert.equal(prepared.evidence.trimmedMs, 0);
      assert.deepEqual(await readFile(prepared.path), source.wav);
      assert.deepEqual(prepared.metadata, getPcm16WavMetadata(source.wav));
      assert.equal(
        prepared.evidence.sha256,
        createHash('sha256').update(source.wav).digest('hex'),
      );
    } finally {
      await prepared.cleanup();
    }
    await assert.rejects(access(dirname(prepared.path)), { code: 'ENOENT' });
  });

  test(`${scenario} temporary playback can be cleaned after an attempt fails without changing its source`, async () => {
    const source = fixture();
    const original = Buffer.from(source.wav);
    const prepared = await prepareBargeInStimulus({
      scenario,
      sourceWav: source.wav,
      fixtureVad: vad,
    });
    const failure = new Error('Playback failed');
    await assert.rejects(
      async () => {
        try {
          assert.deepEqual(await readFile(prepared.path), prepared.wav);
          throw failure;
        } finally {
          await prepared.cleanup();
        }
      },
      (error) => error === failure,
    );
    await assert.rejects(access(dirname(prepared.path)), { code: 'ENOENT' });
    assert.deepEqual(source.wav, original);
  });
}
