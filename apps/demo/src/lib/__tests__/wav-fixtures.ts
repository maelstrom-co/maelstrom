/**
 * Build a minimal structurally complete PCM WAV for tests.
 *
 * The layout is RIFF/WAVE + a 16-byte PCM `fmt ` chunk + a `data` chunk.
 * Extra bytes after the 44-byte header become PCM sample payload.
 *
 * @throws {Error} When `byteLength` is below 44 or is odd.
 */
export function makeValidWavBytes(byteLength = 44): ArrayBuffer {
  if (byteLength < 44) {
    throw new Error('makeValidWavBytes requires at least 44 bytes');
  }
  if (byteLength % 2 !== 0) {
    throw new Error('makeValidWavBytes requires an even byte length');
  }

  const bytes = new Uint8Array(byteLength);
  const view = new DataView(bytes.buffer);
  const dataSize = byteLength - 44;

  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, byteLength - 8, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE

  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 24_000, true); // sample rate
  view.setUint32(28, 48_000, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  return bytes.buffer;
}
