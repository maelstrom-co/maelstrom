// Low-level wrapper around ONNX Runtime Web to load and run the Silero VAD model.
//
// The silero model is a recurrent  neural network that takes a window of audio samples and a context of previous samples to produce a speech probability.

import * as ort from 'onnxruntime-web';

// Silero VAD model constants
const SAMPLE_RATE_16K = 16000;
const CONTEXT_SAMPLES = 64;

const WINDOW_SIZE_SAMPLES_16K = 512; // 32ms @ 16kHz

const STATE_DIMS: readonly number[] = [2, 1, 128];
const STATE_SIZE = 2 * 1 * 128; // 256 floats

export interface SileroVADConfig {
  modelPath?: string;
  sampleRate?: 16000;
}

export interface SileroVADResult {
  probability: number;
}

/**
 * Low-level Silero VAD ONNX model wrapper.
 * Handles model loading, tensor management, and inference.
 * Each SileroVAD instance maintains its own state and context, allowing for independent processing of multiple audio streams if needed.
 * If the instance is deleted, the state is lost, yet, since we deal with 32ms windows and
 * the idea is to use speech and silence thresholds to aggregate segments, the state is not critical to be kept across sessions, but
 * obviously we needed for the best model performance. The reset() method can be used to clear the state between sessions or utterances.
 */
export class SileroVAD {
  #session: ort.InferenceSession | null = null;
  #state: Float32Array;
  #context: Float32Array;
  #sampleRate: 16000;
  #windowSizeSamples: number;
  #isLoaded = false;

  constructor(config: SileroVADConfig = {}) {
    this.#sampleRate = config.sampleRate ?? SAMPLE_RATE_16K;

    this.#windowSizeSamples = WINDOW_SIZE_SAMPLES_16K;

    // Initialize state tensors (zeros)
    this.#state = new Float32Array(STATE_SIZE);
    this.#context = new Float32Array(CONTEXT_SAMPLES);
  }
  /**
   * Load the ONNX model. Must be called before process().
   */
  async load(modelPath: string = '/models/silero_vad.v5.onnx'): Promise<void> {
    if (this.#isLoaded) return;
    // Configure WASM backend
    ort.env.wasm.wasmPaths =
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/';

    // Create inference session
    this.#session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    this.#isLoaded = true;
  }

  /**
   * Process an audio chunk and return speech probability.
   * This calls the model inference and updates internal state for the next call.
   *
   * @param audioChunk - Float32Array of audio samples (must be windowSizeSamples length)
   * @returns Speech probability (0-1)
   */
  async process(audioChunk: Float32Array): Promise<SileroVADResult> {
    if (!this.#session) {
      throw new Error('SileroVAD: Model not loaded. Call load() first.');
    }

    if (audioChunk.length !== this.#windowSizeSamples) {
      throw new Error(
        `SileroVAD: Expected ${this.#windowSizeSamples} samples, got ${audioChunk.length}`,
      );
    }

    // Build input: [context (64 samples), audioChunk (512 samples)] = 576 samples
    const effectiveWindowSize = CONTEXT_SAMPLES + this.#windowSizeSamples;
    const inputData = new Float32Array(effectiveWindowSize);

    inputData.set(this.#context, 0);
    inputData.set(audioChunk, CONTEXT_SAMPLES);

    // Create tensors
    const inputTensor = new ort.Tensor('float32', inputData, [
      1,
      effectiveWindowSize,
    ]);
    const stateTensor = new ort.Tensor('float32', this.#state, STATE_DIMS);
    const srTensor = new ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(this.#sampleRate)]),
      [1],
    );

    // Run inference
    const results = await this.#session.run({
      input: inputTensor,
      state: stateTensor,
      sr: srTensor,
    });

    // Extract outputs
    const probability = (results.output.data as Float32Array)[0];
    const newState = results.stateN.data as Float32Array;
    // Update state for next iteration
    this.#state.set(newState);
    // Update context: last 64 samples of the current input
    this.#context.set(inputData.subarray(inputData.length - CONTEXT_SAMPLES));

    return { probability };
  }

  /**
   * Reset internal state (call between utterances or sessions).
   */
  reset(): void {
    this.#state.fill(0);
    this.#context.fill(0);
  }

  /**
   * Clean up resources.
   * Save the RAM
   */
  async dispose(): Promise<void> {
    if (this.#session) {
      // Note: ONNX Runtime Web sessions don't have an explicit dispose,
      // but we clear the reference to allow GC
      this.#session = null;
    }
    this.#isLoaded = false;
  }

  /**
   * Check if model is loaded and ready.
   */
  get ready(): boolean {
    return this.#isLoaded && this.#session !== null;
  }

  /**
   * Get the expected window size in samples.
   */
  get windowSize(): number {
    return this.#windowSizeSamples;
  }

  /**
   * Get the configured sample rate.
   */
  get rate(): number {
    return this.#sampleRate;
  }
}
