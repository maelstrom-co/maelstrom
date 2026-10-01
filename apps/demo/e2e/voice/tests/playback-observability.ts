export type Pcm16WavMetadata = {
  readonly sampleRate: number;
  readonly channels: number;
  readonly frameCount: number;
  readonly durationMs: number;
};

export type CompletedPlayback = {
  readonly status: 'completed';
};

export function serializePlaybackObservation(
  fixture: Pcm16WavMetadata,
  playback: CompletedPlayback,
  elapsedMs: number,
  workletStartFrame: number,
  workletEndFrame: number,
) {
  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    !Number.isSafeInteger(workletStartFrame) ||
    !Number.isSafeInteger(workletEndFrame) ||
    workletStartFrame < 0 ||
    workletEndFrame < workletStartFrame
  )
    throw new Error('Playback observation has invalid timing metadata');
  return {
    fixture: {
      sampleRate: fixture.sampleRate,
      channels: fixture.channels,
      frameCount: fixture.frameCount,
      durationMs: fixture.durationMs,
    },
    playback: {
      status: playback.status,
      elapsedMs,
      workletStartFrame,
      workletEndFrame,
    },
  };
}

export function getPcm16WavMetadata(wav: Buffer): Pcm16WavMetadata {
  if (
    wav.length < 12 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error('Fixture is not a RIFF/WAVE file');

  let format:
    | { channels: number; sampleRate: number; bitsPerSample: number }
    | undefined;
  let dataLength: number | undefined;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const chunkLength = wav.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > wav.length)
      throw new Error('Fixture has a truncated WAV chunk');
    if (chunkId === 'fmt ') {
      if (chunkLength < 16)
        throw new Error('Fixture has an incomplete WAV format chunk');
      const audioFormat = wav.readUInt16LE(chunkStart);
      const channels = wav.readUInt16LE(chunkStart + 2);
      const sampleRate = wav.readUInt32LE(chunkStart + 4);
      const bitsPerSample = wav.readUInt16LE(chunkStart + 14);
      if (audioFormat !== 1 || bitsPerSample !== 16)
        throw new Error('Fixture must use PCM16 WAV encoding');
      format = { channels, sampleRate, bitsPerSample };
    }
    if (chunkId === 'data') dataLength = chunkLength;
    offset = chunkEnd + (chunkLength % 2);
  }
  if (!format || dataLength === undefined)
    throw new Error('Fixture is missing a WAV format or data chunk');
  if (
    !Number.isSafeInteger(format.sampleRate) ||
    format.sampleRate <= 0 ||
    !Number.isSafeInteger(format.channels) ||
    format.channels <= 0
  )
    throw new Error('Fixture has invalid WAV dimensions');
  const bytesPerFrame = format.channels * 2;
  if (dataLength % bytesPerFrame !== 0)
    throw new Error('Fixture PCM data ends partway through a frame');
  const frameCount = dataLength / bytesPerFrame;
  return {
    sampleRate: format.sampleRate,
    channels: format.channels,
    frameCount,
    durationMs: (frameCount / format.sampleRate) * 1_000,
  };
}

export function parseCompletedPlayback(stdout: string): CompletedPlayback {
  try {
    const value: unknown = JSON.parse(stdout);
    if (
      typeof value === 'object' &&
      value !== null &&
      'status' in value &&
      value.status === 'completed'
    )
      return { status: 'completed' };
  } catch {
    // Keep command output out of test errors and attached metadata.
  }
  throw new Error('Audio playback did not report completed status');
}
