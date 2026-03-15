/**
 * Parses a binary audio frame from the server.
 *
 * The frame format is:
 * - Byte 0: Flags (bit 0 = cancellable)
 * - Bytes 1+: Audio data
 *
 * This is a standard format used across all voice-capable connectors
 * (WebSocket, WebRTC, etc.).
 *
 * @param raw - Raw binary data as Uint8Array
 * @returns Parsed audio data and metadata
 *
 * @example
 * ```typescript
 * // In a voice connector's message handler:
 * ws.onmessage = (event) => {
 *   if (event.data instanceof ArrayBuffer) {
 *     const { data, meta } = parseAudioFrame(new Uint8Array(event.data));
 *     audioPlayer.play(data, meta);
 *   }
 * };
 * ```
 */
export function parseAudioFrame(raw: Uint8Array): {
  data: Uint8Array;
  meta: { cancellable: boolean };
} {
  if (raw.length === 0) {
    throw new Error('Empty audio frame');
  }

  const flags = raw[0];
  const data = raw.subarray(1);
  const meta = {
    cancellable: (flags & 0x01) !== 0, // CANCELLABLE flag at bit 0
  };
  return { data, meta };
}

/**
 * Packs audio data into a binary frame for sending to the server.
 *
 * The frame format is:
 * - Byte 0: Flags (bit 0 = cancellable)
 * - Bytes 1+: Audio data
 *
 * This is a standard format used across all voice-capable connectors
 * (WebSocket, WebRTC, etc.).
 *
 * @param data - Audio data as Uint8Array
 * @param meta - Frame metadata
 * @returns Packed binary frame
 *
 * @example
 * ```typescript
 * // In a voice connector's send method:
 * const audioData = new Uint8Array([...]); // From microphone
 * const frame = packAudioFrame(audioData, { cancellable: true });
 * ws.send(frame);
 * ```
 */
export function packAudioFrame(
  data: Uint8Array,
  meta: { cancellable: boolean },
): Uint8Array {
  const flags = meta.cancellable ? 0x01 : 0x00;
  const frame = new Uint8Array(data.length + 1);
  frame[0] = flags;
  frame.set(data, 1);
  return frame;
}
