// @maelstrom/audio/client - Client-side audio utilities
//
// These utilities run in the browser and handle audio recording, playback, etc.
// They don't make API calls directly - use them with your own server endpoints.

// Re-export types for convenience
export type {
  STTConfig,
  STTEvent,
  STTProvider,
  TTSConfig,
  TTSEvent,
  TTSProvider,
  VoiceInfo,
} from './lib/types.js';

/**
 * Records audio from the user's microphone using MediaRecorder.
 * Returns a promise that resolves with the audio data when recording stops.
 *
 * @example
 * ```typescript
 * const { start, stop } = createAudioRecorder({
 *   onDataAvailable: (chunk) => console.log('Got chunk:', chunk.size),
 * });
 *
 * await start();
 * // ... user speaks ...
 * const audioBlob = await stop();
 * ```
 */
export interface AudioRecorderOptions {
  /** Audio MIME type (default: 'audio/webm') */
  mimeType?: string;
  /** Called when audio data is available */
  onDataAvailable?: (chunk: Blob) => void;
  /** Called when recording starts */
  onStart?: () => void;
  /** Called when recording stops */
  onStop?: () => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface AudioRecorder {
  /** Start recording */
  start(): Promise<void>;
  /** Stop recording and return the audio blob */
  stop(): Promise<Blob>;
  /** Check if currently recording */
  isRecording(): boolean;
}

export function createAudioRecorder(
  options: AudioRecorderOptions = {},
): AudioRecorder {
  const { mimeType = 'audio/webm', onDataAvailable, onStart, onStop, onError } =
    options;

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let stream: MediaStream | null = null;

  return {
    async start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];

        mediaRecorder = new MediaRecorder(stream, { mimeType });

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
            onDataAvailable?.(event.data);
          }
        };

        mediaRecorder.onstart = () => onStart?.();
        mediaRecorder.onerror = (event) =>
          onError?.(new Error((event as ErrorEvent).message || 'Recording error'));

        mediaRecorder.start();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw error;
      }
    },

    async stop(): Promise<Blob> {
      return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state !== 'recording') {
          reject(new Error('Not recording'));
          return;
        }

        mediaRecorder.onstop = () => {
          // Stop all tracks
          if (stream) {
            for (const track of stream.getTracks()) {
              track.stop();
            }
          }

          onStop?.();

          const blob = new Blob(audioChunks, { type: mimeType });
          resolve(blob);
        };

        mediaRecorder.stop();
      });
    },

    isRecording() {
      return mediaRecorder?.state === 'recording';
    },
  };
}

/**
 * Plays audio data using the Web Audio API.
 *
 * @example
 * ```typescript
 * const player = createAudioPlayer();
 * await player.play(audioData); // Uint8Array
 * ```
 */
export interface AudioPlayer {
  /** Play audio data */
  play(audioData: Uint8Array | ArrayBuffer): Promise<void>;
  /** Stop playback */
  stop(): void;
  /** Check if currently playing */
  isPlaying(): boolean;
}

export function createAudioPlayer(): AudioPlayer {
  let audioContext: AudioContext | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let playing = false;

  return {
    async play(audioData: Uint8Array | ArrayBuffer): Promise<void> {
      // Stop any current playback
      this.stop();

      // Create AudioContext lazily
      if (!audioContext) {
        audioContext = new AudioContext();
      }

      // Resume if suspended (happens after user interaction requirement)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Decode audio data
      // Need to copy to a new ArrayBuffer because decodeAudioData detaches the buffer
      let arrayBuffer: ArrayBuffer;
      if (audioData instanceof Uint8Array) {
        // Copy the data to a new ArrayBuffer
        arrayBuffer = audioData.slice().buffer as ArrayBuffer;
      } else {
        arrayBuffer = audioData.slice(0);
      }
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Create and play source
      currentSource = audioContext.createBufferSource();
      currentSource.buffer = audioBuffer;
      currentSource.connect(audioContext.destination);

      return new Promise((resolve) => {
        currentSource!.onended = () => {
          playing = false;
          currentSource = null;
          resolve();
        };

        playing = true;
        currentSource!.start();
      });
    },

    stop() {
      if (currentSource) {
        currentSource.stop();
        currentSource = null;
        playing = false;
      }
    },

    isPlaying() {
      return playing;
    },
  };
}

/**
 * Converts a Blob to base64 string for transport.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:audio/webm;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts a base64 string to Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
