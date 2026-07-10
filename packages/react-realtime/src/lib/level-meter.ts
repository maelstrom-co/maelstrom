/** A live audio level reader returned by {@link createLevelMeter}. */
export interface LevelMeter {
  /** Instantaneous level in [0, 1] (RMS of the current analyser frame). */
  read(): number;
  /** Releases the AudioContext. The meter reads 0 afterwards. */
  dispose(): void;
}

/**
 * Meters a live audio stream for UI feedback (voice orbs, waveforms).
 * Pull-based by design: call `read()` inside your own rAF loop instead of
 * receiving a callback, so render cadence stays under the consumer's control.
 */
export function createLevelMeter(
  stream: MediaStream,
  createAudioContext: () => AudioContext = () => new AudioContext(),
): LevelMeter {
  const context = createAudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.frequencyBinCount);
  let disposed = false;

  return {
    read(): number {
      if (disposed) return 0;
      analyser.getByteTimeDomainData(samples);
      let sumSquares = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        sumSquares += centered * centered;
      }
      return Math.sqrt(sumSquares / samples.length);
    },
    dispose(): void {
      disposed = true;
      void context.close();
    },
  };
}
