import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock audio-utils before importing VADProcessor
mock.module('../audio-utils.js', () => ({
  floatToPcm16: (arr: Float32Array) => new Uint8Array(arr.length * 2),
}));

let mockProbability = 0.1;

// Mock SileroVAD before importing VADProcessor
mock.module('./silero-vad.js', () => ({
  SileroVAD: class MockSileroVAD {
    #ready = false;
    async load() {
      this.#ready = true;
    }
    async process() {
      return { probability: mockProbability };
    }
    reset() {}
    async dispose() {}
    get ready() {
      return this.#ready;
    }
    get windowSize() {
      return 512;
    }
    get rate() {
      return 16000;
    }
  },
}));

import { VADProcessor } from './vad-processor.js';
import type { VADEvent } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function processFrames(vad: VADProcessor, n: number): Promise<void> {
  const chunk = new Float32Array(512);
  for (let i = 0; i < n; i++) {
    await vad.process(chunk);
  }
}

/**
 * Small thresholds for fast, predictable tests.
 * One frame at 16kHz/512 samples = 512/16000 = 0.032s.
 */
const FAST_OPTIONS = {
  minSpeechDurationSeconds: 0.032, // 1 frame
  minSilenceDurationSeconds: 0.032, // 1 frame
  activationThreshold: 0.5,
};

function createVAD(
  callbacks: Partial<{
    onSpeechStart: (event: VADEvent, buffered: Uint8Array) => void;
    onSpeechEnd: (event: VADEvent | null, durationMs: number) => void;
    onSpeechProbability: (p: number) => void;
    onError: (err: Error) => void;
    onStateChange: (state: string) => void;
  }> = {},
): VADProcessor {
  return new VADProcessor({
    streamOptions: FAST_OPTIONS,
    onSpeechStart: callbacks.onSpeechStart ?? (() => {}),
    onSpeechEnd: callbacks.onSpeechEnd ?? (() => {}),
    onSpeechProbability: callbacks.onSpeechProbability ?? (() => {}),
    onError: callbacks.onError ?? (() => {}),
    onStateChange: callbacks.onStateChange ?? (() => {}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VADProcessor', () => {
  beforeEach(() => {
    // Default to silence
    mockProbability = 0.1;
  });

  // -------------------------------------------------------------------------
  // Getters / construction
  // -------------------------------------------------------------------------

  describe('construction and getters', () => {
    it('is not ready before load()', () => {
      const vad = createVAD();
      expect(vad.ready).toBe(false);
    });

    it('is ready after load()', async () => {
      const vad = createVAD();
      await vad.load();
      expect(vad.ready).toBe(true);
    });

    it('windowSize is 512', async () => {
      const vad = createVAD();
      await vad.load();
      expect(vad.windowSize).toBe(512);
    });

    it('isSpeaking starts false', async () => {
      const vad = createVAD();
      await vad.load();
      expect(vad.isSpeaking).toBe(false);
    });

    it('currentSampleIndex starts at 0', async () => {
      const vad = createVAD();
      await vad.load();
      expect(vad.currentSampleIndex).toBe(0);
    });

    it('currentSampleIndex advances by 512 per processed frame', async () => {
      const vad = createVAD();
      await vad.load();
      await processFrames(vad, 3);
      expect(vad.currentSampleIndex).toBe(3 * 512);
    });
  });

  // -------------------------------------------------------------------------
  // process() throws when not loaded
  // -------------------------------------------------------------------------

  describe('process() before load()', () => {
    it('throws if model not loaded', async () => {
      const vad = createVAD();
      await expect(vad.process(new Float32Array(512))).rejects.toThrow(
        'VADProcessor: Model not loaded',
      );
    });
  });

  // -------------------------------------------------------------------------
  // onSpeechProbability
  // -------------------------------------------------------------------------

  describe('onSpeechProbability', () => {
    it('is called on every process() call', async () => {
      const probs: number[] = [];
      const vad = createVAD({ onSpeechProbability: (p) => probs.push(p) });
      await vad.load();

      mockProbability = 0.3;
      await processFrames(vad, 4);

      expect(probs).toHaveLength(4);
      expect(probs.every((p) => p === 0.3)).toBe(true);
    });

    it('is called even during silence frames', async () => {
      const probs: number[] = [];
      const vad = createVAD({ onSpeechProbability: (p) => probs.push(p) });
      await vad.load();

      mockProbability = 0.1; // below threshold
      await processFrames(vad, 3);

      expect(probs).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Speech start detection
  // -------------------------------------------------------------------------

  describe('speech start detection', () => {
    it('calls onSpeechStart after minSpeechDurationSeconds of above-threshold frames', async () => {
      const starts: VADEvent[] = [];
      const vad = createVAD({
        onSpeechStart: (event) => starts.push(event),
      });
      await vad.load();

      mockProbability = 0.9; // well above threshold of 0.5
      // With minSpeechDurationSeconds=0.032 (1 frame) we need >= 1 frame above threshold.
      // The state machine schedules mayStartAtSample = currentSample + minSpeechSamples
      // and checks mayStartAtSample <= currentSample AFTER incrementing.
      // 2 frames ensures we cross the threshold.
      await processFrames(vad, 2);

      expect(starts).toHaveLength(1);
      expect(starts[0].type).toBe('speech_start');
      expect(vad.isSpeaking).toBe(true);
    });

    it('does not call onSpeechStart for below-threshold frames', async () => {
      const starts: VADEvent[] = [];
      const vad = createVAD({ onSpeechStart: (event) => starts.push(event) });
      await vad.load();

      mockProbability = 0.1; // below threshold
      await processFrames(vad, 10);

      expect(starts).toHaveLength(0);
      expect(vad.isSpeaking).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Speech end detection
  // -------------------------------------------------------------------------

  describe('speech end detection', () => {
    it('calls onSpeechEnd after minSilenceDurationSeconds following speech', async () => {
      const starts: VADEvent[] = [];
      const ends: Array<{ event: VADEvent | null; durationMs: number }> = [];
      const vad = createVAD({
        onSpeechStart: (event) => starts.push(event),
        onSpeechEnd: (event, durationMs) => ends.push({ event, durationMs }),
      });
      await vad.load();

      // Start speech
      mockProbability = 0.9;
      await processFrames(vad, 2);
      expect(starts).toHaveLength(1);

      // End speech
      mockProbability = 0.1;
      await processFrames(vad, 2);

      expect(ends).toHaveLength(1);
      expect(ends[0].event?.type).toBe('speech_end');
      expect(ends[0].durationMs).toBeGreaterThanOrEqual(0);
      expect(vad.isSpeaking).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Asymmetric behavior — sporadic silence during speech
  // -------------------------------------------------------------------------

  describe('asymmetric behavior: sporadic silence during speech', () => {
    it('does NOT end speech on a single below-threshold frame during speech', async () => {
      const ends: Array<VADEvent | null> = [];
      const vad = createVAD({
        onSpeechEnd: (event) => ends.push(event),
      });
      await vad.load();

      // Establish speech
      mockProbability = 0.9;
      await processFrames(vad, 2);
      expect(vad.isSpeaking).toBe(true);

      // One sporadic silent frame
      mockProbability = 0.1;
      await processFrames(vad, 1);

      // Return to speech
      mockProbability = 0.9;
      await processFrames(vad, 1);

      // Speech should still be active, no end emitted
      expect(ends).toHaveLength(0);
      expect(vad.isSpeaking).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Asymmetric behavior — sporadic speech during silence
  // -------------------------------------------------------------------------

  describe('asymmetric behavior: sporadic speech during silence resets end detection', () => {
    it('resets end-of-speech detection when a speech frame appears during silence', async () => {
      const ends: Array<{ event: VADEvent | null; durationMs: number }> = [];

      // Use wider silence window to make the test controllable
      const customVad = new VADProcessor({
        streamOptions: {
          minSpeechDurationSeconds: 0.032,
          minSilenceDurationSeconds: 0.064, // 2 frames
          activationThreshold: 0.5,
        },
        onSpeechStart: () => {},
        onSpeechEnd: (event, durationMs) => ends.push({ event, durationMs }),
        onSpeechProbability: () => {},
        onError: () => {},
        onStateChange: () => {},
      });
      await customVad.load();

      // Establish speech
      mockProbability = 0.9;
      await processFrames(customVad, 2);
      expect(customVad.isSpeaking).toBe(true);

      // First silence frame — begins end-detection countdown
      mockProbability = 0.1;
      await processFrames(customVad, 1);
      expect(ends).toHaveLength(0); // Not ended yet (need 2 frames)

      // Sporadic speech frame — should cancel end detection
      mockProbability = 0.9;
      await processFrames(customVad, 1);

      // Back to silence — full countdown must restart
      mockProbability = 0.1;
      await processFrames(customVad, 1);

      // Still not ended (only 1 silent frame since sporadic speech)
      expect(ends).toHaveLength(0);
      expect(customVad.isSpeaking).toBe(true);

      // Second silence frame — countdown still hasn't reached threshold
      await processFrames(customVad, 1);
      expect(ends).toHaveLength(0);

      // Third silence frame — NOW the threshold is reached
      await processFrames(customVad, 1);
      expect(ends).toHaveLength(1);
      expect(customVad.isSpeaking).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  describe('reset()', () => {
    it('clears isSpeaking after speech has started', async () => {
      const vad = createVAD();
      await vad.load();

      mockProbability = 0.9;
      await processFrames(vad, 2);
      expect(vad.isSpeaking).toBe(true);

      vad.reset();
      expect(vad.isSpeaking).toBe(false);
    });

    it('resets currentSampleIndex to 0', async () => {
      const vad = createVAD();
      await vad.load();

      await processFrames(vad, 5);
      expect(vad.currentSampleIndex).toBe(5 * 512);

      vad.reset();
      expect(vad.currentSampleIndex).toBe(0);
    });

    it('allows speech detection to work normally after reset', async () => {
      const starts: VADEvent[] = [];
      const vad = createVAD({ onSpeechStart: (event) => starts.push(event) });
      await vad.load();

      mockProbability = 0.9;
      await processFrames(vad, 2);
      expect(starts).toHaveLength(1);

      vad.reset();
      starts.length = 0;

      mockProbability = 0.9;
      await processFrames(vad, 2);
      expect(starts).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // forceEndSpeech()
  // -------------------------------------------------------------------------

  describe('forceEndSpeech()', () => {
    it('emits onSpeechEnd with null event when currently speaking', async () => {
      const ends: Array<{ event: VADEvent | null; durationMs: number }> = [];
      const vad = createVAD({
        onSpeechEnd: (event, durationMs) => ends.push({ event, durationMs }),
      });
      await vad.load();

      mockProbability = 0.9;
      await processFrames(vad, 2);
      expect(vad.isSpeaking).toBe(true);

      vad.forceEndSpeech();

      expect(ends).toHaveLength(1);
      expect(ends[0].event).toBeNull();
      expect(vad.isSpeaking).toBe(false);
    });

    it('does nothing when not speaking', async () => {
      const ends: unknown[] = [];
      const vad = createVAD({ onSpeechEnd: (event) => ends.push(event) });
      await vad.load();

      vad.forceEndSpeech();

      expect(ends).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // setPlaybackMode()
  // -------------------------------------------------------------------------

  describe('setPlaybackMode()', () => {
    it('raises threshold during playback so moderate speech does not trigger detection', async () => {
      const starts: VADEvent[] = [];
      const vad = createVAD({ onSpeechStart: (event) => starts.push(event) });
      await vad.load();

      // Enable playback mode — threshold raised to 0.8
      vad.setPlaybackMode(true);

      // Probability above default (0.5) but below playback threshold (0.8)
      mockProbability = 0.7;
      await processFrames(vad, 5);

      // Should NOT have triggered speech start
      expect(starts).toHaveLength(0);
      expect(vad.isSpeaking).toBe(false);
    });

    it('restores default threshold when playback ends', async () => {
      const starts: VADEvent[] = [];
      const vad = createVAD({ onSpeechStart: (event) => starts.push(event) });
      await vad.load();

      vad.setPlaybackMode(true);
      vad.setPlaybackMode(false);

      // Probability above default threshold (0.5) — should now trigger
      mockProbability = 0.7;
      await processFrames(vad, 2);

      expect(starts).toHaveLength(1);
      expect(vad.isSpeaking).toBe(true);
    });

    it('very high probability still triggers detection even in playback mode', async () => {
      const starts: VADEvent[] = [];
      const vad = createVAD({ onSpeechStart: (event) => starts.push(event) });
      await vad.load();

      vad.setPlaybackMode(true);

      // Above playback threshold (0.8)
      mockProbability = 0.9;
      await processFrames(vad, 2);

      expect(starts).toHaveLength(1);
      expect(vad.isSpeaking).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Ring buffer / buffered audio
  // -------------------------------------------------------------------------

  describe('buffered audio on speech start', () => {
    it('passes non-empty Uint8Array to onSpeechStart', async () => {
      let capturedBuffer: Uint8Array | null = null;
      const vad = createVAD({
        onSpeechStart: (_event, buffered) => {
          capturedBuffer = buffered;
        },
      });
      await vad.load();

      mockProbability = 0.9;
      await processFrames(vad, 2);

      expect(capturedBuffer).not.toBeNull();
      expect(capturedBuffer!.byteLength).toBeGreaterThan(0);
    });

    it('ring buffer is cleared after speech start event', async () => {
      let callCount = 0;
      let lastBuffer: Uint8Array | null = null;
      const vad = createVAD({
        onSpeechStart: (_event, buffered) => {
          callCount++;
          lastBuffer = buffered;
        },
      });
      await vad.load();

      // First speech segment
      mockProbability = 0.9;
      await processFrames(vad, 2);
      expect(callCount).toBe(1);

      // End first segment
      mockProbability = 0.1;
      await processFrames(vad, 2);

      // Second speech segment — ring buffer should have been reset
      mockProbability = 0.9;
      await processFrames(vad, 2);

      // The second start should have fired
      expect(callCount).toBe(2);
      // Buffer should be non-empty (ring buffer accumulates between segments)
      expect(lastBuffer!.byteLength).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // dispose()
  // -------------------------------------------------------------------------

  describe('dispose()', () => {
    it('can be called without throwing', async () => {
      const vad = createVAD();
      await vad.load();
      await expect(vad.dispose()).resolves.toBeUndefined();
    });
  });
});
