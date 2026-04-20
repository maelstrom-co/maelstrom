/**
 * Convert Float32 audio samples to PCM 16-bit little-endian bytes.
 *
 * Float32 range [-1, 1] maps to Int16 range [-32768, 32767].
 * The asymmetric formula handles the fact that Int16 has one more
 * negative value than positive.
 */
export function floatToPcm16(float32Array: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}
