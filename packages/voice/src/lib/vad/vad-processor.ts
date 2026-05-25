/*
 * Higher-level speech detection logic that wraps SileroVAD and emits speechStart/speechEnd events based on configurable thresholds.
 * This is the main class that users will interact with. It manages the SileroVAD instance, handles audio buffering, and implements the logic to determine when speech starts and ends based on the probabilities emitted by SileroVAD.
 * SileroVAD infers over 32ms audio chunks, that is small, for example, saying "yes" can take up to 100ms, 3 packets, and the idea is to use the speech and silence thresholds to aggregate those packets into segments. The VADProcessor will emit speechStart at the moment the first packet is detected as speech, but it will internally keep aggregating the packets until it detects that speech has ended based on the silence threshold, and only then it will emit speechEnd with the total duration of the detected speech segment.
 *
 * THERE IS A BIG ISSUE on browsers, for this to work perfectly together with the TTS being heard by the VAD, we need AEC to be enabled in the browser. Then, we raise the threshold of the vad to PLAYBACK_ACTIVATION_THRESHOLD (0.8) when the TTS is playing, so we can also have the chance to do barge-in. If AEC is not enabled, then we can have false positives during TTS playback, and the VAD will detect the TTS as speech, which is not ideal. */

import { floatToPcm16 } from '../audio-utils.js';
import { SileroVAD } from './silero-vad.js';
import type { VADModelConfig, VADEvent, VADEvents } from './types.js';


import { toError } from '@maelstrom-co/protocol';const WINDOW_SIZE_SAMPLES = 512;
const SAMPLE_RATE = 16000;
const DEFAULT_VAD_MODEL_URL = 'https://pub-fa2f334103a642e4985ac6016c6e7180.r2.dev/silero_vad.v5.onnx';
const PLAYBACK_ACTIVATION_THRESHOLD = 0.8;

/**
 * Configuration for VAD stream processing.
 * Maps to Go's VADStreamOptions.
 */
export interface VADStreamOptions {
  /**
   * Minimum continuous speech duration before START_OF_SPEECH (seconds).
   * - Smaller → faster barge-in, more false starts
   * - Larger → steadier detection, delays start
   * @default 0.05
   */
  minSpeechDurationSeconds?: number;
  /**
   * Minimum continuous silence duration before END_OF_SPEECH (seconds).
   * - Smaller → ends quicker, risks truncating words
   * - Larger → more natural endings, higher latency
   * @default 0.8
   */
  minSilenceDurationSeconds?: number;
  /**
   * Speech probability threshold (0-1).
   * - Higher (0.6-0.8) → fewer false positives, may miss quiet speech
   * - Lower (0.4-0.5) → catches quiet speech, may trigger on noise
   * @default 0.7
   */
  activationThreshold?: number;

  maxUserTalkingDurationSeconds?: number;

  /**
   * Padding duration to include before detected speech start (seconds).
   *
   * */
  preSpeechPaddingSeconds?: number;
}
interface StreamState {
  /** Whether we've publicly announced speech is happening */
  pubSpeaking: boolean;
  /** Sample index when speech MAY start (after threshold), -1 if not pending */
  mayStartAtSample: number;
  /** Sample index when speech MAY end (after silence threshold), -1 if not pending */
  mayEndAtSample: number;
  /** Current sample index in the stream */
  currentSample: number;
  /** Sample index when speech actually started (for duration calculation) */
  speechStartSample: number;
  /** Minimum speech samples before emitting start (derived from seconds) */
  minSpeechSamples: number;
  /** Minimum silence samples before emitting end (derived from seconds) */
  minSilenceSamples: number;
  /** ringBuffer to hold samples for the speech threshold  */
  ringBuffer: Float32Array[];
  /** speechPaddingSamples: number; */
  paddingSamples: number;
}

interface VADProcessorConfig extends VADModelConfig, VADEvents {
  streamOptions: VADStreamOptions;
}

/**
 * VAD Processor - handles speech detection logic with proper state machine.
 *
 * Symmetric state reset:
 * - Sporadic silence during speech → does NOT cancel speech detection
 * - Sporadic speech during silence → DOES cancel end-of-speech detection
 */
export class VADProcessor {
  #vad: SileroVAD;
  #modelPath: string;
  #events: VADEvents;
  #state: StreamState;
  #activationThreshold: number;
  #defaultThreshold: number;

  constructor(config: VADProcessorConfig) {
    const sampleRate = config.sampleRate ?? SAMPLE_RATE;
    const streamOptions = config.streamOptions ?? {};

    this.#modelPath = config.modelPath ?? DEFAULT_VAD_MODEL_URL;
    this.#defaultThreshold = streamOptions.activationThreshold ?? 0.7;
    this.#activationThreshold = this.#defaultThreshold;

    const minSpeechSeconds = streamOptions.minSpeechDurationSeconds ?? 0.05;
    const minSilenceSeconds = streamOptions.minSilenceDurationSeconds ?? 0.8;
    const speechPaddingSeconds = streamOptions.preSpeechPaddingSeconds ?? 0.3;

    this.#state = {
      pubSpeaking: false,
      mayStartAtSample: -1,
      mayEndAtSample: -1,
      currentSample: 0,
      speechStartSample: 0,
      minSpeechSamples: Math.floor(minSpeechSeconds * sampleRate),
      minSilenceSamples: Math.floor(minSilenceSeconds * sampleRate),
      paddingSamples: Math.floor(speechPaddingSeconds * sampleRate),
      // The ringbuffer has the size of speech threshild duration, so we can keep the audio during the threshold and emit it when speech is detected
      ringBuffer: [],
    };

    this.#events = {
      onSpeechStart: config.onSpeechStart,
      onSpeechEnd: config.onSpeechEnd,
      onSpeechProbability: config.onSpeechProbability,
      onError: config.onError,
      onStateChange: config.onStateChange,
    };

    this.#vad = new SileroVAD({ sampleRate });
  }

  /**
   * Load the VAD model.
   */
  async load(): Promise<void> {
    try {
      await this.#vad.load(this.#modelPath);
    } catch (error) {
      this.#events.onError?.(
        toError(error),
      );
      throw error;
    }
  }

  /**
   * Process an audio chunk (512 samples @ 16kHz).
   */
  async process(audioChunk: Float32Array): Promise<void> {
    if (!this.#vad.ready) {
      throw new Error('VADProcessor: Model not loaded. Call load() first.');
    }
    try {
      this.#pushToRingBuffer(audioChunk);
      const { probability } = await this.#vad.process(audioChunk);
      // Always emit probability for UI feedback, e.g. the voice button glows based on this
      this.#events.onSpeechProbability?.(probability);
      // Update current sample AFTER inference (matches Go behavior)
      this.#state.currentSample += WINDOW_SIZE_SAMPLES;
      const isSpeech = probability >= this.#activationThreshold;
      if (isSpeech) {
        this.#processRawSpeaking(probability);
      } else {
        this.#processSilence(probability);
      }
    } catch (error) {
      this.#events.onError?.(
        toError(error),
      );
    }
  }

  /**
   * Push new audio chunk into the ring buffer for potential inclusion in speech start event.
   * This should be called with every new chunk, regardless of speech/silence, to ensure we have the recent audio available when speech is detected.
   * We should push until the size of the ring buffer is the speech threshold size,
   * and then keep it updated with the most recent audio, so when speech is detected, we can emit the buffered audio since the first probability that crossed the threshold, which is the idea of bufferedSinceFirstProb in the onSpeechStart event.
   */
  #pushToRingBuffer(chunk: Float32Array): void {
    this.#state.ringBuffer.push(chunk);
    // discard the first chunk if we exceed the size of the speech threshold duration
    // use minSpeechSamples to calculate how many chunks we need to keep, since each chunk is WINDOW_SIZE_SAMPLES long
    // consider also the padding samples, so we can emit audio before the detected speech start
    const maxChunks = Math.ceil(
      (this.#state.minSpeechSamples + this.#state.paddingSamples) /
        WINDOW_SIZE_SAMPLES,
    );
    if (this.#state.ringBuffer.length > maxChunks) {
      this.#state.ringBuffer.shift();
    }
  }

  /**
   * Handle speech detected frame.
   * Key: Sporadic speech during silence DOES cancel end-of-speech detection.
   */
  #processRawSpeaking(probability: number): void {
    // Cancel any pending end-of-speech (speech resumed)
    this.#state.mayEndAtSample = -1;
    // Schedule potential start-of-speech if not already scheduled
    if (this.#state.mayStartAtSample === -1) {
      this.#state.mayStartAtSample =
        this.#state.currentSample + this.#state.minSpeechSamples;
    }
    // Check if we've reached the speech threshold
    if (
      this.#state.mayStartAtSample <= this.#state.currentSample &&
      !this.#state.pubSpeaking
    ) {
      this.#state.pubSpeaking = true;
      this.#state.speechStartSample = this.#state.currentSample;
      this.#emitSpeechStart(probability);
    }
  }
  /**
   * Handle silence detected frame.
   * Key: Sporadic silence during speech does NOT cancel speech detection.
   * mayStartAtSample is only reset AFTER confirmed end-of-speech.
   */
  #processSilence(probability: number): void {
    // Schedule potential end-of-speech if not already scheduled
    if (this.#state.mayEndAtSample === -1) {
      this.#state.mayEndAtSample =
        this.#state.currentSample + this.#state.minSilenceSamples;
    }
    // Check if we've reached the silence threshold AND we're currently speaking
    if (
      this.#state.mayEndAtSample <= this.#state.currentSample &&
      this.#state.pubSpeaking
    ) {
      // Only reset mayStartAtSample after CONFIRMED end-of-speech
      this.#state.mayStartAtSample = -1;
      this.#state.pubSpeaking = false;
      this.#emitSpeechEnd(probability);
    }
  }
  #emitSpeechStart(probability: number): void {
    const event: VADEvent = {
      type: 'speech_start',
      sampleIndex: this.#state.currentSample,
      decidedAtSampleIndex: this.#state.mayStartAtSample,
      offsetMs: this.#samplesToMs(this.#state.currentSample),
      probability,
    };

    this.#events.onSpeechStart?.(event, this.#ringBufferToFlatUint8Array());
    // clear the buffer
    this.#state.ringBuffer = [];
  }

  #ringBufferToFlatUint8Array(): Uint8Array {
    const totalSamples = this.#state.ringBuffer.length * WINDOW_SIZE_SAMPLES;
    const flatArray = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of this.#state.ringBuffer) {
      flatArray.set(chunk, offset);
      offset += chunk.length;
    }
    return floatToPcm16(flatArray);
  }

  #emitSpeechEnd(probability: number): void {
    const durationMs = this.#samplesToMs(
      this.#state.currentSample - this.#state.speechStartSample,
    );

    const event: VADEvent = {
      type: 'speech_end',
      sampleIndex: this.#state.currentSample,
      decidedAtSampleIndex: this.#state.mayEndAtSample,
      offsetMs: durationMs,
      probability,
    };
    this.#events.onSpeechEnd?.(event, durationMs);
  }
  /**
   * Reset state for new session.
   */
  reset(): void {
    this.#vad.reset();
    this.#state.pubSpeaking = false;
    this.#state.mayStartAtSample = -1;
    this.#state.mayEndAtSample = -1;
    this.#state.currentSample = 0;
  }
  /**
   * Force end speech (for interrupts/cleanup).
   */
  forceEndSpeech(): void {
    if (this.#state.pubSpeaking) {
      this.#state.pubSpeaking = false;
      this.#state.mayStartAtSample = -1;
      this.#state.mayEndAtSample = -1;
      this.#events.onSpeechEnd?.(
        null,
        this.#samplesToMs(
          this.#state.currentSample - this.#state.speechStartSample,
        ),
      );
    }
  }

  setPlaybackMode(isPlaying: boolean): void {
    if (isPlaying) {
      // Raise threshold during playback to avoid false positives from AEC residue
      this.#activationThreshold = PLAYBACK_ACTIVATION_THRESHOLD;
    } else {
      // Reset to default threshold after playback
      this.#activationThreshold = this.#defaultThreshold;
    }
  }

  async dispose(): Promise<void> {
    await this.#vad.dispose();
  }

  get ready(): boolean {
    return this.#vad.ready;
  }

  get windowSize(): number {
    return WINDOW_SIZE_SAMPLES;
  }

  get isSpeaking(): boolean {
    return this.#state.pubSpeaking;
  }

  get currentSampleIndex(): number {
    return this.#state.currentSample;
  }

  #samplesToMs(samples: number): number {
    return (samples * 1000) / SAMPLE_RATE;
  }
}
