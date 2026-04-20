/**
 * Framework-agnostic audio capture engine for streaming microphone input.
 *
 * Acquires microphone access via `getUserMedia`, processes audio through an
 * AudioWorklet for low-latency buffering, and emits PCM16 chunks suitable for
 * streaming to a voice backend (e.g., via WebSocket).
 *
 * ## Audio format contract
 *
 * | Direction | Format               | Sample rate | Channels |
 * |-----------|----------------------|-------------|----------|
 * | Mic input | Float32 (Web Audio)  | 16 kHz      | mono     |
 * | Output    | PCM16 linear16       | 16 kHz      | mono     |
 *
 * The 16 kHz sample rate is standard for speech recognition APIs (Google,
 * Deepgram, OpenAI Whisper). Higher rates waste bandwidth without improving
 * transcription quality for human speech.
 *
 * ## Why AudioWorklet instead of ScriptProcessorNode?
 *
 * `ScriptProcessorNode` runs on the main thread and is deprecated. It causes
 * audio glitches when the main thread is busy (React renders, GC pauses).
 * AudioWorklet runs on a dedicated audio thread with real-time priority,
 * giving us reliable ~256ms chunks regardless of main thread activity.
 *
 * ## Why inline worklet code (Blob URL)?
 *
 * AudioWorklet requires a separate module file, but bundlers (Vite, webpack)
 * handle worklet files inconsistently. By embedding the code as a string and
 * creating a Blob URL at runtime, we avoid build configuration headaches and
 * ensure the worklet works identically in dev, test, and production.
 *
 * @example
 * ```ts
 * const capture = new AudioCapture({ sampleRate: 16000 });
 *
 * capture.on('audio', (pcm16, float32) => {
 *   websocket.send(pcm16); // Stream to backend
 *   vad.process(float32);  // Feed to VAD
 * });
 *
 * capture.on('error', (err) => console.error('Mic error:', err));
 *
 * await capture.start();
 * // ... user speaks ...
 * capture.stop();
 * ```
 */

/**
 * Inline AudioWorklet processor code.
 *
 * **Why 4096 samples buffer size:**
 * At 16 kHz, 4096 samples = 256 ms of audio per chunk. This balances:
 * - **Latency:** Small enough that the user doesn't perceive delay
 * - **IPC overhead:** Large enough to amortize the cost of postMessage()
 * - **VAD accuracy:** Enough samples for reliable voice activity detection
 *
 * Smaller buffers (e.g., 128 samples = 8ms) would fire postMessage() 32x more
 * often, overwhelming the main thread. Larger buffers add perceptible latency.
 *
 * **Why `return true`:** Returning `true` from `process()` keeps the processor
 * alive. Returning `false` would disconnect it (useful for one-shot effects,
 * not for continuous capture).
 */

import { floatToPcm16 } from '../audio-utils.js';

const WORKLET_CODE = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.bufferIndex++] = channelData[i];
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage(this.buffer.slice());
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('audio-capture-processor', AudioCaptureProcessor);
`;

/**
 * Cached Blob URL for the worklet module.
 *
 * **Why cache:** `URL.createObjectURL()` allocates memory that persists until
 * `URL.revokeObjectURL()` is called. Creating a new URL on every `start()`
 * would leak memory. By caching, we create exactly one URL for the lifetime
 * of the page.
 *
 * **Why never revoke:** The worklet URL must remain valid for the entire
 * session — if revoked, subsequent `AudioContext.audioWorklet.addModule()`
 * calls would fail. Since we only create one URL and it's tiny (~1KB), the
 * "leak" is negligible.
 */
let workletBlobUrl: string | null = null;

function getWorkletUrl(): string {
  if (!workletBlobUrl) {
    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    workletBlobUrl = URL.createObjectURL(blob);
  }
  return workletBlobUrl;
}

export interface AudioCaptureOptions {
  /**
   * Sample rate for audio capture.
   *
   * **Recommended: 16000 (16 kHz)**
   *
   * This is the standard rate for speech recognition APIs. Higher rates
   * (44.1 kHz, 48 kHz) waste bandwidth without improving transcription
   * quality — human speech frequencies max out around 8 kHz.
   */
  sampleRate?: number;

  /**
   * Buffer size for the AudioWorklet (optional, currently unused).
   *
   * Reserved for future use if we need configurable chunk sizes.
   */
  bufferSize?: number;

  /**
   * When `true`, logs capture lifecycle events and errors to the console.
   */
  debugMode?: boolean;
}

type AudioCaptureEventMap = {
  audio: (pcm16: Uint8Array, float32: Float32Array) => void;
  error: (error: Error) => void;
};

type AudioCaptureEvent = keyof AudioCaptureEventMap;

/**
 * Internal mutable state for the capture engine.
 *
 * Grouped into a single object for atomic cleanup in `stop()` and to clearly
 * separate configuration (`options`) from runtime state that changes during
 * capture.
 */
interface AudioCaptureState {
  /**
   * The Web Audio context driving the capture pipeline.
   *
   * Created with the configured sample rate so the browser handles any
   * necessary resampling from the hardware's native rate.
   */
  audioContext: AudioContext | null;

  /**
   * The AudioWorkletNode that buffers and emits audio chunks.
   *
   * Communicates with the main thread via `port.onmessage`.
   */
  captureNode: AudioWorkletNode | null;

  /**
   * The source node wrapping the microphone MediaStream.
   *
   * Must be stored for proper cleanup — disconnecting it releases the
   * connection to the worklet.
   */
  sourceNode: MediaStreamAudioSourceNode | null;

  /**
   * The raw MediaStream from `getUserMedia()`.
   *
   * Must be stored so we can call `track.stop()` on cleanup — this is the
   * only way to release the microphone and turn off the browser's recording
   * indicator.
   */
  mediaStream: MediaStream | null;

  /**
   * Whether the capture pipeline is currently active.
   *
   * Used to prevent double-start and enable early-exit in `stop()`.
   */
  isCapturing: boolean;
}

export class AudioCapture {
  #state: AudioCaptureState;
  #options: AudioCaptureOptions;
  #listeners = new Map<
    AudioCaptureEvent,
    Set<AudioCaptureEventMap[AudioCaptureEvent]>
  >();

  constructor(options: AudioCaptureOptions) {
    this.#options = options;
    this.#state = {
      audioContext: null,
      captureNode: null,
      sourceNode: null,
      mediaStream: null,
      isCapturing: false,
    };
  }

  /**
   * Request microphone permission and start the capture pipeline.
   *
   * **Pipeline architecture:**
   * ```
   * getUserMedia → MediaStreamSource → AudioWorkletNode → (buffered chunks)
   *                                            ↓
   *                                     port.postMessage()
   *                                            ↓
   *                                   floatTo16BitPCM() → emit('audio')
   * ```
   *
   * **Why echoCancellation + noiseSuppression:**
   * These WebRTC constraints enable browser-level acoustic echo cancellation
   * (AEC) and noise suppression. Without AEC, the mic would pick up TTS
   * playback and create feedback loops. Without noise suppression, keyboard
   * clicks and fan noise would trigger false VAD positives.
   *
   * @throws Emits 'error' event if mic access is denied or unavailable.
   */
  async start(): Promise<void> {
    if (this.#state.isCapturing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.#options.sampleRate ?? 16000,
          channelCount: 1,
          // These constraints enable browser-level echo cancellation and noise suppression.
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      const audioContext = new AudioContext({
        sampleRate: this.#options.sampleRate ?? 16000,
      });
      await audioContext.audioWorklet.addModule(getWorkletUrl());

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const captureNode = new AudioWorkletNode(
        audioContext,
        'audio-capture-processor',
        { outputChannelCount: [1] },
      );

      sourceNode.connect(captureNode);
      // Connect to destination to keep the audio graph alive.
      // The worklet doesn't produce audible output — it just captures.
      captureNode.connect(audioContext.destination);

      captureNode.port.onmessage = (event) => {
        const float32 = event.data as Float32Array;
        const pcm16 = this.#floatTo16BitPCM(float32);
        this.#emitAudio(pcm16, float32);
      };

      this.#state.audioContext = audioContext;
      this.#state.captureNode = captureNode;
      this.#state.mediaStream = stream;
      this.#state.sourceNode = sourceNode;
      this.#state.isCapturing = true;
    } catch (err) {
      if (this.#options.debugMode) {
        console.error('[AudioCapture] Start error:', err);
      }
      this.#emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  #emitAudio(pcm16: Uint8Array, float32: Float32Array): void {
    const set = this.#listeners.get('audio');
    if (!set) return;
    for (const cb of set) {
      try {
        (cb as AudioCaptureEventMap['audio'])(pcm16, float32);
      } catch (err) {
        console.error('[AudioCapture] listener error (audio):', err);
      }
    }
  }

  #emitError(error: Error): void {
    const set = this.#listeners.get('error');
    if (!set) return;
    for (const cb of set) {
      try {
        (cb as AudioCaptureEventMap['error'])(error);
      } catch (err) {
        console.error('[AudioCapture] listener error (error):', err);
      }
    }
  }

  /**
   * Stop capture and release all resources.
   *
   * **Cleanup order matters:**
   * 1. Disconnect nodes (stops audio flow)
   * 2. Stop MediaStream tracks (releases microphone, turns off browser indicator)
   * 3. Close AudioContext (frees audio thread resources)
   * 4. Null out references (allows GC)
   *
   * Calling `stop()` multiple times is safe (early-exits if not capturing).
   */
  stop(): void {
    if (!this.#state.isCapturing) return;

    this.#state.captureNode?.disconnect();
    this.#state.sourceNode?.disconnect();
    this.#state.mediaStream?.getTracks().forEach((t) => {
      t.stop();
    });
    this.#state.audioContext?.close();

    this.#state.captureNode = null;
    this.#state.sourceNode = null;
    this.#state.mediaStream = null;
    this.#state.audioContext = null;
    this.#state.isCapturing = false;
  }

  /**
   * Whether the capture pipeline is active and ready to emit audio.
   *
   * Returns `true` only if all components are initialized and connected.
   * Use this to guard UI state (e.g., show recording indicator).
   */
  get isReady(): boolean {
    return !!(
      this.#state.isCapturing &&
      this.#state.captureNode &&
      this.#state.audioContext
    );
  }

  /**
   * Alias for `stop()` — provided for API consistency with AudioPlayback.
   *
   * After `destroy()`, this instance can be reused by calling `start()` again.
   */
  destroy(): void {
    this.stop();
  }

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to capture events.
   *
   * - `audio` — Fired when a chunk of audio is captured (~256ms at 16 kHz).
   *   Provides both PCM16 (for backend) and Float32 (for VAD).
   *
   * - `error` — Fired when capture fails (e.g., mic permission denied,
   *   device unavailable).
   *
   * @returns An unsubscribe function. Call it to remove the listener.
   */
  on<K extends AudioCaptureEvent>(
    event: K,
    cb: AudioCaptureEventMap[K],
  ): () => void {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event)?.add(cb);
    return () => this.#listeners.get(event)?.delete(cb);
  }

  // ---------------------------------------------------------------------------
  // Codec
  // ---------------------------------------------------------------------------

  /**
   * Convert Float32 audio samples to PCM16 (linear16) format.
   *
   * **Why PCM16:** This is the standard format for speech APIs (Google STT,
   * Deepgram, OpenAI Whisper). It's 2 bytes per sample (vs 4 for Float32),
   * cutting bandwidth in half while maintaining sufficient dynamic range
   * for speech.
   *
   * **Why little-endian:** Convention for most speech APIs. The `true`
   * parameter to `setInt16()` specifies little-endian byte order.
   *
   * **Sample conversion:** Float32 range [-1, 1] maps to Int16 range
   * [-32768, 32767]. The asymmetric formula handles the fact that Int16
   * has one more negative value than positive.
   */
  #floatTo16BitPCM(float32Array: Float32Array): Uint8Array {
    return floatToPcm16(float32Array);
  }
}
