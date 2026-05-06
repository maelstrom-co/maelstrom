import { toError } from '@maelstrom-co/protocol';
/**
 * Framework-agnostic audio playback engine for streaming TTS output.
 *
 * Receives PCM f32le audio chunks from the server (via WebSocket binary frames),
 * decodes them into Float32 samples, and schedules gapless playback through the
 * Web Audio API. Supports barge-in (instant interruption when the user starts
 * speaking) and stale-packet discarding to keep latency low.
 *
 *
 * ## Audio format contract
 *
 * | Direction | Format               | Sample rate | Channels |
 * |-----------|----------------------|-------------|----------|
 * | Server →  | PCM f32le (raw bytes)| 44.1 kHz    | mono     |
 * | Playback  | Web Audio stereo buf | 44.1 kHz    | stereo   |
 *
 * Mono input is duplicated to stereo channels. WebAudio handles any
 * resampling to the system output rate automatically.
 *
 * ## Gapless scheduling
 *
 * Each chunk is scheduled to start at `max(ctx.currentTime, nextPlayTime)`,
 * where `nextPlayTime` advances by the buffer duration after every schedule.
 * This avoids audible gaps between consecutive chunks while still allowing the
 * browser to catch up if a chunk arrives late.
 *
 * @example
 * ```ts
 * const playback = new AudioPlayback({ sampleRate: 44100 });
 *
 * playback.on('playbackStart', () => console.log('TTS started'));
 * playback.on('playbackEnd',   () => console.log('TTS finished'));
 *
 * connector.onBinaryAudio((data) => playback.enqueue(data));
 *
 * // User starts talking — cut the TTS immediately
 * vad.onSpeechStart(() => playback.interrupt());
 * ```
 */

/** Default maximum age (ms) before a queued packet is discarded. */
const MAX_PACKET_AGE_MS_DEFAULT = 200;

export interface AudioPlaybackOptions {
  /** Sample rate for the output AudioContext (typically 44100). */
  sampleRate: number;

  /**
   * Maximum allowed age (ms) for a queued audio packet.
   *
   * When the playback loop picks a packet off the queue it checks
   * `performance.now() - packet.timestamp`. If the packet is older than this
   * threshold it is silently dropped and the next one is tried.
   *
   * **Why:** In a real-time voice conversation, playing stale audio is worse
   * than skipping it — the user would hear delayed speech that no longer matches
   * the conversation context. 200 ms is a good default because it's below the
   * perceptual threshold for conversational lag while still tolerating minor
   * scheduling jitter.
   *
   * @default 200
   */
  maxPacketAgeMs?: number;

  /** When `true`, logs scheduling decisions and packet ages to the console. */
  debugMode?: boolean;
}

/**
 * Internal mutable state for the playback engine.
 *
 * Grouped into a single object so it's easy to reset atomically in `destroy()`
 * and to distinguish "configuration that never changes" (`config`) from
 * "runtime state that mutates on every audio frame" (`state`).
 */
interface AudioPlaybackState {
  /**
   * Lazily-created Web Audio output context.
   *
   * **Why lazy:** Browsers require an `AudioContext` to be created (or resumed)
   * inside a user-gesture callback. By deferring creation to the first
   * `enqueue()` call we avoid a "The AudioContext was not allowed to start"
   * console warning. The caller is responsible for ensuring `enqueue()` is
   * ultimately triggered from a user action (e.g. a "Start Listening" button).
   */
  outputAudioContext: AudioContext | null;

  /**
   * Timestamped queue of decoded Float32 audio chunks waiting to be scheduled.
   *
   * Each entry carries the `performance.now()` timestamp from when the raw
   * bytes arrived off the WebSocket. This lets `playNextAudio` discard packets
   * that sat in the queue too long (see `maxPacketAgeMs`).
   *
   * **Why timestamps:** Without them we'd have no way to detect queue
   * congestion. If the main thread blocks (GC pause, heavy React render) the
   * queue grows and the user would hear time-shifted audio. Timestamps let us
   * drop stale packets and stay in sync with the conversation.
   */
  receivedAudioWithTimestamps: { data: Float32Array; timestamp: number }[];

  /**
   * The `AudioContext.currentTime` at which the *next* buffer should start.
   *
   * **Why this matters for gapless playback:** The Web Audio scheduler works in
   * "context time" — a monotonically increasing clock owned by the audio
   * thread. By advancing `nextPlayTime` by exactly `buffer.duration` after
   * every schedule, consecutive buffers play back-to-back with sample-accurate
   * timing and zero gaps. If we just used `ctx.currentTime` each time we'd get
   * tiny silences between chunks because of the round-trip to the main thread.
   */
  nextPlayTime: number;

  /**
   * Set of `AudioBufferSourceNode`s currently scheduled or playing.
   *
   * **Why we track them:** Web Audio source nodes are fire-and-forget — once
   * you call `source.start()` you can't query them for "are you done?". We
   * need to:
   *
   * 1. **Interrupt (barge-in):** When the user starts speaking while TTS is playing we must
   *    call `source.stop()` on every active node *immediately*. Without this
   *    set we'd have no references to stop.
   *
   * 2. **Detect playback end:** Each node's `onended` callback removes itself
   *    from the set. When the set is empty *and* there are no more queued
   *    chunks, we know playback has truly finished and can emit `playbackEnd`.
   *
   * 3. **Cleanup:** On `destroy()` we iterate the set to stop any in-flight
   *    sources before closing the AudioContext.
   *
   * The `try/catch` around `source.stop()` is necessary because a source that
   * already reached its end will throw `InvalidStateError` if stopped again.
   */
  activeSources: Set<AudioBufferSourceNode>;

  /**
   * Whether audio is actively being output through the speakers.
   *
   * Transitions:
   * - `false → true` on the first `source.start()` call → emits `playbackStart`
   * - `true → false` when the last source ends with an empty queue, or on
   *   `interrupt()` → emits `playbackEnd`
   *
   * **Why a separate flag instead of `activeSources.size > 0`:** Source nodes
   * can be *scheduled* (in the set) but not yet audible — their start time may
   * be in the future. `isPlayingInternal` represents the logical "is the user hearing
   * audio right now" state, which is what the rest of the system cares about
   * (e.g. to toggle VAD sensitivity during TTS output).
   */
  isPlayingInternal: boolean;

  /**
   * Set to `true` once playback finishes naturally (not via interrupt).
   *
   * **Why:** Allows consumers to distinguish between "TTS completed fully" and
   * "TTS was cut short by barge-in". Currently used for analytics; the public
   * API exposes this distinction through the `playbackEnd` event timing
   * relative to `interrupt()`.
   */
  audioEnded: boolean;
}

type AudioPlaybackEvent = 'playbackStart' | 'playbackEnd' | 'error';

type AudioPlaybackEventCallbacks = {
  playbackStart: () => void;
  playbackEnd: () => void;
  error: (err: Error) => void;
};

export class AudioPlayback {
  #state: AudioPlaybackState;
  #config: AudioPlaybackOptions;
  #isDrainLoopRunning = false;
  #listeners: {
    [E in AudioPlaybackEvent]: Set<AudioPlaybackEventCallbacks[E]>;
  } = {
    playbackStart: new Set(),
    playbackEnd: new Set(),
    error: new Set(),
  };

  constructor(options: AudioPlaybackOptions) {
    this.#config = options;
    this.#state = {
      outputAudioContext: null,
      receivedAudioWithTimestamps: [],
      nextPlayTime: 0,
      activeSources: new Set(),
      isPlayingInternal: false,
      audioEnded: false,
    };
  }

  /**
   * Prime the output path before network-delivered TTS arrives.
   *
   * WHY: `enqueue()` runs from async transport callbacks, which browsers do
   * not treat as user gestures. Preparing the `AudioContext` during the same
   * click/tap flow that starts voice avoids a blocked playback path later when
   * the first binary TTS frame finally arrives.
   */
  async prepare(): Promise<void> {
    await this.#getOrCreateOutputContext();
  }

  /**
   * Feed raw TTS audio into the playback queue.
   *
   * Decodes the incoming `Uint8Array` (PCM f32le) into `Float32Array` samples,
   * slices them into 512-sample chunks (~11.6 ms at 44.1 kHz), timestamps each
   * chunk, and kicks the scheduling loop.
   *
   * **Why 512-sample chunks:** Smaller chunks give finer-grained packet-age
   * checks and smoother barge-in (we discard/stop at chunk boundaries). 512 is
   * a power-of-two that aligns well with audio hardware buffer sizes.
   */
  enqueue(data: Uint8Array): void {
    if (data.length > 0) {
      const floatData = this.#pcmF32leToFloat32(data);
      const receiveTimestamp = performance.now();

      const CHUNK_SIZE = 512;
      for (let i = 0; i < floatData.length; i += CHUNK_SIZE) {
        const chunk = floatData.slice(i, i + CHUNK_SIZE);
        this.#state.receivedAudioWithTimestamps.push({
          data: chunk,
          timestamp: receiveTimestamp,
        });
      }

      this.#drainQueue();
    }
  }

  #drainQueue(): void {
    if (this.#isDrainLoopRunning) {
      return;
    }

    this.#isDrainLoopRunning = true;
    void (async () => {
      try {
        while (this.#state.receivedAudioWithTimestamps.length > 0) {
          await this.#playNextAudio();
        }
      } catch (err) {
        this.#reportError(err);
      } finally {
        this.#isDrainLoopRunning = false;

        if (this.#state.receivedAudioWithTimestamps.length > 0) {
          this.#drainQueue();
        }
      }
    })();
  }

  /**
   * Recursive scheduling loop: pops the next chunk off the queue, checks its
   * age, creates a stereo `AudioBuffer`, and schedules it for gapless playback.
   *
   * Calls itself recursively (fire-and-forget) while chunks remain so that a
   * burst of `enqueue()` calls results in a single scheduling pass rather than
   * N independent passes.
   */
  async #playNextAudio(): Promise<void> {
    if (this.#state.receivedAudioWithTimestamps.length === 0) return;
    let ctx: AudioContext;
    try {
      ctx = await this.#getOrCreateOutputContext();
    } catch (err) {
      this.#state.receivedAudioWithTimestamps = [];
      this.#reportError(err);
      return;
    }
    try {
      const audioWithTimestamp =
        this.#state.receivedAudioWithTimestamps.shift();
      if (!audioWithTimestamp) return;
      const { data: chunk, timestamp } = audioWithTimestamp;

      // Discard packets that have been sitting in the queue too long.
      // See `maxPacketAgeMs` docs for the rationale.
      const receiveTime = performance.now();
      const ageMs = receiveTime - timestamp;

      if (ageMs > (this.#config.maxPacketAgeMs ?? MAX_PACKET_AGE_MS_DEFAULT)) {
        if (this.#config.debugMode) {
          console.log(
            `[AudioPlayback] Discarding delayed packet: ${ageMs.toFixed(1)}ms old (max: ${this.#config.maxPacketAgeMs}ms)`,
          );
        }
        return Promise.resolve();
      }
      if (this.#config.debugMode) {
        console.log(
          `[AudioPlayback] Playing audio packet (age: ${ageMs.toFixed(1)}ms)`,
        );
      }

      const totalSamples = chunk.length;
      if (this.#config.debugMode) {
        let maxAbs = 0;
        let minVal = 0;
        let maxVal = 0;
        for (let i = 0; i < Math.min(chunk.length, 1000); i++) {
          const v = chunk[i];
          if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
          if (v < minVal) minVal = v;
          if (v > maxVal) maxVal = v;
        }
        console.log(
          `[AudioPlayback] Scheduling ${totalSamples} samples at ${this.#config.sampleRate}Hz, queue: ${this.#state.receivedAudioWithTimestamps.length}`,
        );
        console.log(
          `[AudioPlayback] Sample values: min=${minVal.toFixed(4)}, max=${maxVal.toFixed(4)}, maxAbs=${maxAbs.toFixed(4)}`,
        );
      }

      const audioBuffer = ctx.createBuffer(
        2,
        totalSamples,
        this.#config.sampleRate,
      );
      audioBuffer.getChannelData(0).set(chunk);
      audioBuffer.getChannelData(1).set(chunk);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      const contextTime = ctx.currentTime;

      // Gapless scheduling: start exactly where the previous buffer ends.
      // If we've fallen behind (contextTime > nextPlayTime), snap forward to
      // avoid playing audio in the past (which the browser would play
      // immediately, causing overlap).
      const startTime = Math.max(contextTime, this.#state.nextPlayTime);
      this.#state.nextPlayTime = startTime + audioBuffer.duration;

      // Track this source so we can stop it on barge-in and detect when all
      // playback has finished (see `activeSources` docs above).
      this.#state.activeSources.add(source);

      source.onended = () => {
        this.#state.activeSources.delete(source);
        if (
          this.#state.activeSources.size === 0 &&
          this.#state.receivedAudioWithTimestamps.length === 0
        ) {
          this.#state.isPlayingInternal = false;
          this.#state.audioEnded = true;
          this.#emit('playbackEnd');
        }
      };

      // Only emit playbackStart on the false→true transition so consumers
      // get exactly one event per playback session, not one per chunk.
      const wasPlaying = this.#state.isPlayingInternal;
      this.#state.isPlayingInternal = true;
      if (!wasPlaying) {
        this.#emit('playbackStart');
      }

      if (this.#config.debugMode) {
        console.log(
          `[AudioPlayback] source.start(${startTime.toFixed(3)}), ctx.currentTime=${contextTime.toFixed(3)}, ctx.state=${ctx.state}`,
        );
      }
      source.start(startTime);
    } catch (err) {
      this.#reportError(err);
    }
  }

  #reportError(err: unknown): void {
    const error = toError(err);
    console.error('[AudioPlayback] Audio playback error:', error);
    this.#emit('error', error);
  }

  /**
   * Lazily creates (or resumes) the output `AudioContext`.
   *
   * Safari and Chrome suspend contexts created outside a user gesture. The
   * `resume()` call handles the case where the context was auto-suspended
   * between voice sessions.
   */
  async #getOrCreateOutputContext(): Promise<AudioContext> {
    if (!this.#state.outputAudioContext) {
      this.#state.outputAudioContext = new AudioContext({
        sampleRate: this.#config.sampleRate,
      });
      if (this.#config.debugMode) {
        console.log(
          `[AudioPlayback] Created AudioContext at ${this.#state.outputAudioContext.sampleRate}Hz, state: ${this.#state.outputAudioContext.state}`,
        );
      }
    }

    if (this.#state.outputAudioContext.state === 'suspended') {
      if (this.#config.debugMode) {
        console.log('[AudioPlayback] Resuming suspended AudioContext');
      }
      await this.#state.outputAudioContext.resume();
    }

    return this.#state.outputAudioContext;
  }

  /**
   * Immediately stop all audio output and clear the queue.
   *
   * Called on barge-in (user starts speaking while TTS is playing). Stops every
   * in-flight `AudioBufferSourceNode`, resets the scheduling cursor, and emits
   * `playbackEnd` so consumers can update UI state (e.g. hide the speaking
   * indicator).
   */
  interrupt(): void {
    if (this.#state.isPlayingInternal) {
      if (this.#config.debugMode) {
        console.log(
          '[AudioPlayback] Barge-in triggered — interrupting TTS playback',
        );
      }
      this.#state.activeSources.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Source may have already ended naturally between our check and stop().
        }
      });
      this.#state.activeSources.clear();
      this.#state.nextPlayTime = 0;
      this.#state.isPlayingInternal = false;
      this.#state.receivedAudioWithTimestamps = [];
      this.#emit('playbackEnd');
    }
  }

  /** Whether audio is currently being played through the speakers. */
  get isPlaying(): boolean {
    return this.#state.isPlayingInternal;
  }

  /**
   * Release all resources: close the AudioContext, stop any in-flight sources,
   * clear the queue, and remove all event listeners.
   *
   * After `destroy()` this instance is unusable — create a new one if needed.
   */
  destroy(): void {
    if (this.#state.outputAudioContext) {
      this.#state.outputAudioContext.close();
      this.#state.outputAudioContext = null;
    }
    this.#state.receivedAudioWithTimestamps = [];
    this.#state.nextPlayTime = 0;
    this.#state.activeSources.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Source may have already ended naturally.
      }
    });
    this.#state.activeSources.clear();
    this.#state.isPlayingInternal = false;
    this.#state.audioEnded = false;
    this.#listeners.playbackStart.clear();
    this.#listeners.playbackEnd.clear();
    this.#listeners.error.clear();
  }

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to playback lifecycle events.
   *
   * - `playbackStart` — Fired once when the first chunk begins playing (not
   *   per-chunk). Use this to show a "speaking" indicator or raise the VAD
   *   threshold to avoid echo false-positives.
   *
   * - `playbackEnd` — Fired when all queued audio has finished playing *or*
   *   when `interrupt()` is called. Use this to hide the speaking indicator
   *   and restore normal VAD sensitivity.
   *
   * - `error` — Fired when the playback pipeline encounters a runtime error
   *   (e.g. `AudioContext` creation fails, `createBuffer` throws). Consumers
   *   should surface this to users — the playback queue keeps running but the
   *   failing chunk is dropped.
   *
   * @returns An unsubscribe function. Call it to remove the listener.
   */
  on(event: 'playbackStart', cb: () => void): () => void;
  on(event: 'playbackEnd', cb: () => void): () => void;
  on(event: 'error', cb: (err: Error) => void): () => void;
  on<E extends AudioPlaybackEvent>(
    event: E,
    cb: AudioPlaybackEventCallbacks[E],
  ): () => void {
    const set = this.#listeners[event] as Set<AudioPlaybackEventCallbacks[E]>;
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  #emit<E extends AudioPlaybackEvent>(
    event: E,
    ...args: Parameters<AudioPlaybackEventCallbacks[E]>
  ): void {
    const set = this.#listeners[event] as Set<(...a: unknown[]) => void>;
    for (const cb of set) {
      try {
        cb(...args);
      } catch (err) {
        console.error(`[AudioPlayback] listener error (${event}):`, err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Codec
  // ---------------------------------------------------------------------------

  /**
   * Decode a raw `Uint8Array` of PCM 32-bit float little-endian samples into a
   * `Float32Array` suitable for Web Audio buffers.
   */
  #pcmF32leToFloat32(uint8Array: Uint8Array): Float32Array {
    const byteLength = uint8Array.length;
    const floatCount = Math.floor(byteLength / 4);
    const result = new Float32Array(floatCount);
    const dataView = new DataView(
      uint8Array.buffer,
      uint8Array.byteOffset,
      uint8Array.byteLength,
    );
    for (let i = 0; i < floatCount; i++) {
      result[i] = dataView.getFloat32(i * 4, true);
    }
    return result;
  }
}
