// React hook that manages VADProcessor lifecycle
//
//

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type VADEvent,
  VADProcessor,
  type VADState,
  type VADStreamOptions,
} from '@maelstrom-co/voice';

const VAD_WINDOW_SIZE = 512; // Silero VAD requires 512 samples per inference

export interface UseVADOptions {
  /** Path to Silero ONNX model */
  modelPath?: string;

  /** VAD stream processing options */
  streamOptions?: VADStreamOptions;

  /**
   * Lookback buffer size in ms. Audio is buffered so that when speech
   * starts, we can include audio from before the detection point.
   * Should be >= minSpeechDurationSeconds.
   * @default 500
   */
  lookbackBufferMs?: number;

  /**
   * Called when speech segment starts.
   * Includes pre-buffered audio from before detection point.
   */
  onSpeechStart?: (event: VADEvent, bufferedAudio: Uint8Array) => void;

  /**
   * Called for each audio chunk during active speech.
   * Chunks are 512 samples (32ms) converted to PCM16.
   */
  onSpeechAudio?: (chunk: Uint8Array) => void;

  /**
   * Called when speech segment ends.
   * @param event - VAD event (null if forced end via stop())
   * @param durationMs - Total speech duration
   */
  onSpeechEnd?: (event: VADEvent | null, durationMs: number) => void;

  /** Called with speech probability (0-1) for each processed chunk */
  onSpeechProbability?: (probability: number) => void;

  /** Called on errors (model load, processing) */
  onError?: (error: Error) => void;

  /** Called when VAD state changes */
  onStateChange?: (state: VADState) => void;
}

export interface UseVADReturn {
  /** Current VAD state */
  state: VADState;

  /** Whether speech is currently detected */
  isSpeaking: boolean;

  /** Current speech probability (0-1) */
  probability: number;

  /**
   * Feed audio chunks from your AudioWorklet.
   * Accepts Float32Array (browser native format).
   * Internally buffers and slices to 512-sample VAD windows.
   */
  processAudio: (chunk: Float32Array) => Promise<void>;

  /** Initialize VAD (loads model on first call) */
  start: () => Promise<void>;

  /** Stop VAD, force end any active speech */
  stop: () => void;

  /** Switch between normal/playback threshold modes */
  setPlaybackMode: (playing: boolean) => void;

  /** Current error, if any */
  error: Error | null;
}

// Simplified now for testing - will implement full logic in next iteration
export function useVAD(options: UseVADOptions = {}): UseVADReturn {
  // State
  const [state, setState] = useState<VADState>('uninitialized');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [probability, setProbability] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  // Refs
  const processorRef = useRef<VADProcessor | null>(null);
  const pendingBufferRef = useRef<Float32Array>(new Float32Array(0));
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      processorRef.current?.dispose();
    };
  }, []);
  // processAudio: slice 4096-sample chunks into 512-sample windows
  const processAudio = useCallback(async (chunk: Float32Array) => {
    const processor = processorRef.current;
    if (!processor || !processor.ready) {
      // lo g warning but don't throw - this can happen if audio starts before model is loaded
      console.warn(
        'VADProcessor not ready. Call start() and wait for ready state before processing audio.',
      );
      return;
    }
    // Concatenate with any pending samples from previous call
    const combined =
      pendingBufferRef.current.length > 0
        ? concatFloat32Arrays(pendingBufferRef.current, chunk)
        : chunk;
    // Process complete 512-sample windows
    let offset = 0;
    while (offset + VAD_WINDOW_SIZE <= combined.length) {
      const window = combined.slice(offset, offset + VAD_WINDOW_SIZE);
      await processor.process(window);
      offset += VAD_WINDOW_SIZE;
    }
    // Store remainder for next call
    pendingBufferRef.current =
      offset < combined.length ? combined.slice(offset) : new Float32Array(0);
  }, []);
  const start = useCallback(async () => {
    if (processorRef.current) {
      return; // Already initialized
    }
    try {
      setState('loading');
      const processor = new VADProcessor({
        modelPath: optionsRef.current.modelPath ?? '/models/silero_vad.v5.onnx',
        streamOptions: optionsRef.current.streamOptions ?? {},
        onSpeechStart: (event, bufferedMayStartAtAudio) => {
          setIsSpeaking(true);
          optionsRef.current.onSpeechStart?.(event, bufferedMayStartAtAudio);
        },
        onSpeechEnd: (event, durationMs) => {
          setIsSpeaking(false);
          optionsRef.current.onSpeechEnd?.(event, durationMs);
        },
        onSpeechProbability: (prob) => {
          setProbability(prob);
          optionsRef.current.onSpeechProbability?.(prob);
        },
        onError: (err) => {
          setError(err);
          optionsRef.current.onError?.(err);
        },
        onStateChange: (state) => {
          setState(state);
          optionsRef.current.onStateChange?.(state);
        },
      });
      await processor.load();
      processorRef.current = processor;
      setState('ready');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setState('error');
      optionsRef.current.onError?.(error);
    }
  }, []);
  const stop = useCallback(() => {
    const processor = processorRef.current;
    if (processor) {
      processor.forceEndSpeech();
      processor.dispose();
      processorRef.current = null;
    }
    pendingBufferRef.current = new Float32Array(0);
    setState('uninitialized');
    setIsSpeaking(false);
    setProbability(0);
  }, []);
  const setPlaybackMode = useCallback((playing: boolean) => {
    processorRef.current?.setPlaybackMode(playing);
  }, []);
  return {
    state,
    isSpeaking,
    probability,
    processAudio,
    start,
    stop,
    setPlaybackMode,
    error,
  };
}

function concatFloat32Arrays(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}
