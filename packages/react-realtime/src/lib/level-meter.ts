/** A live audio level reader returned by {@link createLevelMeter}. */
export interface LevelMeter {
  /** Instantaneous level in [0, 1] (RMS of the current analyser frame). */
  read(): number;
  /**
   * Disconnects this meter's audio nodes and, once no meter is active
   * anymore, suspends the shared AudioContext. The meter reads 0 afterwards.
   */
  dispose(): void;
}

// Browsers cap concurrent AudioContexts (Safari allows very few), and
// close() resolves asynchronously — rebuilding a whole context per
// push-to-talk press let rapid presses stack not-yet-closed contexts and hit
// that cap, silently killing the meter. One context is created lazily,
// reference-counted across active meters, and never closed; only the cheap
// per-stream nodes (source + analyser) are rebuilt per meter.
let sharedContext: AudioContext | null = null;
let activeMeters = 0;
let contextFactory: () => AudioContext = () => new AudioContext();

/**
 * Meters a live audio stream for UI feedback (voice orbs, waveforms).
 * Pull-based by design: call `read()` inside your own rAF loop instead of
 * receiving a callback, so render cadence stays under the consumer's control.
 * Shares one lazily-created `AudioContext` across all active meters (see
 * module notes above) — there is no way to supply your own context.
 *
 * @example
 * const meter = createLevelMeter(stream);
 * const level = meter.read(); // 0..1, call again each animation frame
 * meter.dispose(); // stops metering this stream when done
 */
export function createLevelMeter(stream: MediaStream): LevelMeter {
  if (!sharedContext) sharedContext = contextFactory();
  const context = sharedContext;
  void context.resume().catch(() => {});

  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);
  // Counted only once both nodes exist: an early throw (e.g. an ended
  // stream) must not wedge the refcount above zero with no meter to dispose.
  activeMeters += 1;
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
      if (disposed) return;
      disposed = true;
      source.disconnect();
      analyser.disconnect();
      activeMeters -= 1;
      if (activeMeters <= 0) {
        activeMeters = 0;
        void context.suspend().catch(() => {});
      }
    },
  };
}

// Process-wide singleton state above must be reset between tests; not part
// of the public barrel, so it stays out of consumers' hands. The optional
// factory stands in for `new AudioContext()` the next time a meter lazily
// creates the shared context, letting tests inject a fake without a public
// param on createLevelMeter itself.
export function resetLevelMeterAudioContextForTesting(
  factory?: () => AudioContext,
): void {
  sharedContext = null;
  activeMeters = 0;
  contextFactory = factory ?? (() => new AudioContext());
}
