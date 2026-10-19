function validateInfoChunk(wav: Buffer, start: number, end: number): void {
  if (end - start < 4 || wav.toString('latin1', start, start + 4) !== 'INFO')
    throw new Error(
      'Only LIST/INFO ancillary metadata is supported for trimming',
    );
  let offset = start + 4;
  while (offset < end) {
    if (offset + 8 > end) throw new Error('Truncated WAV INFO chunk header');
    const length = wav.readUInt32LE(offset + 4);
    offset += 8 + length + (length % 2);
    if (offset > end) throw new Error('Truncated WAV INFO chunk or padding');
  }
}

export function trimPcm16Wav(wav: Buffer, cutFrame: number): Buffer {
  if (
    wav.length < 12 ||
    wav.toString('latin1', 0, 4) !== 'RIFF' ||
    wav.toString('latin1', 8, 12) !== 'WAVE'
  )
    throw new Error('Prefix trimming requires a RIFF/WAVE file');
  if (wav.readUInt32LE(4) !== wav.length - 8)
    throw new Error('WAV RIFF size does not match the file length');

  let bytesPerFrame: number | undefined;
  let data: { start: number; length: number } | undefined;
  let offset = 12;
  while (offset < wav.length) {
    if (offset + 8 > wav.length) throw new Error('Truncated WAV chunk header');
    const id = wav.toString('latin1', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    const next = end + (length % 2);
    if (next > wav.length) throw new Error('Truncated WAV chunk or padding');
    switch (id) {
      case 'fmt ': {
        if (bytesPerFrame !== undefined)
          throw new Error('Duplicate WAV format chunk');
        if (
          (length !== 16 && length !== 18) ||
          wav.readUInt16LE(start) !== 1 ||
          wav.readUInt16LE(start + 14) !== 16 ||
          (length === 18 && wav.readUInt16LE(start + 16) !== 0)
        )
          throw new Error('Prefix trimming supports only PCM16 WAV format');
        const channels = wav.readUInt16LE(start + 2);
        const sampleRate = wav.readUInt32LE(start + 4);
        bytesPerFrame = channels * 2;
        if (
          channels === 0 ||
          sampleRate === 0 ||
          wav.readUInt16LE(start + 12) !== bytesPerFrame ||
          wav.readUInt32LE(start + 8) !== sampleRate * bytesPerFrame
        )
          throw new Error('Invalid PCM16 WAV dimensions or frame alignment');
        break;
      }
      case 'data':
        if (data) throw new Error('Duplicate WAV data chunk');
        data = { start, length };
        break;
      case 'LIST':
        validateInfoChunk(wav, start, end);
        break;
      case 'JUNK':
      case 'PAD ':
        break;
      default:
        // Cue/loop offsets and unknown ancillary metadata cannot safely survive a cut.
        throw new Error('Unsupported WAV chunk for prefix trimming');
    }
    offset = next;
  }
  if (bytesPerFrame === undefined || !data)
    throw new Error('WAV must have exactly one format and data chunk');
  if (data.length === 0 || data.length % bytesPerFrame !== 0)
    throw new Error('WAV PCM data must contain complete nonempty frames');
  const frameCount = data.length / bytesPerFrame;
  if (!Number.isSafeInteger(cutFrame) || cutFrame < 0 || cutFrame >= frameCount)
    throw new Error('WAV cut frame must be an integer within the PCM data');

  const removedBytes = cutFrame * bytesPerFrame;
  const trimmed = Buffer.concat([
    wav.subarray(0, data.start),
    wav.subarray(data.start + removedBytes),
  ]);
  trimmed.writeUInt32LE(trimmed.length - 8, 4);
  trimmed.writeUInt32LE(data.length - removedBytes, data.start - 4);
  return trimmed;
}
