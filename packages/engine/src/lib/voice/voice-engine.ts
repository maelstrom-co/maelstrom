/**
 * Voice-enabled engine implementation.
 *
 * This module extends the base Maelstrom engine with voice capabilities,
 * integrating STT and TTS providers for real-time voice conversations.
 */

import type { ChartRequest, MaelstromResponse } from '@maelstrom-co/protocol';

import type { Engine } from '../engine.js';
import { createEngine } from '../engine.js';
import type { EngineConfig } from '../types.js';
import type {
  AudioChunk,
  SpeechChunk,
  STTEvent,
  TranscriptionResult,
  TTSEvent,
  VADEvent,
  VoiceConfig,
  VoiceEngine,
  VoiceEngineCallbacks,
  VoiceSessionState,
} from './types.js';

/**
 * Configuration for voice-enabled engine.
 */
export interface VoiceEngineConfig extends EngineConfig {
  /** Voice configuration (required for voice mode) */
  voice: VoiceConfig;
}

/**
 * Creates a voice-enabled Maelstrom engine.
 *
 * This extends the base engine with voice capabilities, managing the
 * STT/TTS lifecycle and coordinating voice with chart processing.
 *
 * @example
 * ```typescript
 * const engine = createVoiceEngine({
 *   provider: openaiProvider,
 *   voice: {
 *     stt: deepgramProvider,
 *     tts: cartesiaProvider,
 *     mode: 'continuous',
 *     vad: { utteranceEndMs: 2500 },
 *   },
 * });
 *
 * // In continuous mode, listening starts automatically
 * await engine.startListening();
 *
 * // Transcription events flow automatically
 * engine.onTranscript((result) => {
 *   if (result.isFinal) {
 *     console.log('User said:', result.text);
 *   }
 * });
 * ```
 */
export function createVoiceEngine(
  config: VoiceEngineConfig,
  callbacks: VoiceEngineCallbacks = {},
): Engine & VoiceEngine {
  const baseEngine = createEngine(config);
  const {
    stt,
    tts,
    mode = 'continuous',
    autoRestartListening = true,
    vad,
  } = config.voice;

  let state: VoiceSessionState = 'idle';
  let currentTranscript = '';
  let hasReceivedSpeech = false;
  let sttUnsubscribe: (() => void) | null = null;
  let ttsUnsubscribe: (() => void) | null = null;
  let autoRestartTimeout: ReturnType<typeof setTimeout> | null = null;
  let isInitializing = false;
  let startListeningPromise: Promise<void> | null = null;
  const pendingAudioChunks: AudioChunk[] = [];
  const MAX_PENDING_CHUNKS = 50;

  let accumulatedTranscript = '';
  let pendingFinalFromVAD = false;
  let vadFinalDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  let hasEmittedFinal = false;
  const VAD_FINAL_DEBOUNCE_MS = 200;

  function emitFinalTranscript() {
    pendingFinalFromVAD = false;
    if (vadFinalDebounceTimeout) {
      clearTimeout(vadFinalDebounceTimeout);
      vadFinalDebounceTimeout = null;
    }

    if (!currentTranscript || hasEmittedFinal) return;

    hasEmittedFinal = true;
    hasReceivedSpeech = true;
    accumulatedTranscript = currentTranscript;

    const finalResult: TranscriptionResult = {
      text: currentTranscript,
      isFinal: true,
    };
    transcriptListeners.forEach((cb) => {
      cb(finalResult);
    });
    callbacks.onTranscript?.(finalResult);
  }

  // Event listeners
  const stateChangeListeners = new Set<(state: VoiceSessionState) => void>();
  const transcriptListeners = new Set<(result: TranscriptionResult) => void>();
  const vadListeners = new Set<(event: VADEvent) => void>();
  const audioOutputListeners = new Set<(chunk: SpeechChunk) => void>();

  function setVoiceState(newState: VoiceSessionState) {
    if (state !== newState) {
      const previousState = state;
      state = newState;
      stateChangeListeners.forEach((cb) => {
        cb(newState);
      });
      callbacks.onVoiceStateChange?.(newState);

      // Handle auto-restart in continuous/auto mode
      if (
        newState === 'idle' &&
        (mode === 'continuous' || mode === 'auto') &&
        autoRestartListening &&
        previousState === 'speaking'
      ) {
        // Small delay before restarting to avoid immediate loop
        autoRestartTimeout = setTimeout(() => {
          if (state === 'idle') {
            startListening().catch(() => {});
          }
        }, 500);
      }
    }
  }

  function handleSTTEvent(event: STTEvent) {
    switch (event.type) {
      case 'vad': {
        vadListeners.forEach((cb) => {
          cb(event.event);
        });
        callbacks.onVADEvent?.(event.event);
        break;
      }

      case 'transcript': {
        const transcriptText = event.result.text.trim();
        if (transcriptText) {
          if (event.result.isFinal) {
            hasReceivedSpeech = true;
            accumulatedTranscript = accumulatedTranscript
              ? `${accumulatedTranscript} ${transcriptText}`
              : transcriptText;
            currentTranscript = accumulatedTranscript;
          } else {
            currentTranscript = accumulatedTranscript
              ? `${accumulatedTranscript} ${transcriptText}`
              : transcriptText;
          }

          if (pendingFinalFromVAD) {
            emitFinalTranscript();
          } else {
            const interimResult: TranscriptionResult = {
              text: currentTranscript,
              isFinal: false,
            };
            transcriptListeners.forEach((cb) => {
              cb(interimResult);
            });
            callbacks.onTranscript?.(interimResult);
          }
        }
        break;
      }

      case 'error':
        console.log('[VoiceEngine] STT error:', event.error);
        callbacks.onError?.(event.error);
        setVoiceState('idle');
        break;

      case 'disconnected':
        if (state === 'listening') {
          console.log(
            '[VoiceEngine] STT disconnected while listening, attempting reconnect...',
          );
          reconnectSTT();
        }
        break;
    }
  }

  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 3;
  const RECONNECT_DELAY_MS = 1000;

  async function reconnectSTT(): Promise<void> {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[VoiceEngine] Max STT reconnect attempts reached');
      callbacks.onError?.(new Error('STT connection lost after max retries'));
      setVoiceState('idle');
      reconnectAttempts = 0;
      return;
    }

    reconnectAttempts++;
    console.log(
      `[VoiceEngine] STT reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`,
    );

    await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));

    if (state !== 'listening') {
      reconnectAttempts = 0;
      return;
    }

    try {
      await ensureSTTConnected();
      console.log('[VoiceEngine] STT reconnected successfully');
      reconnectAttempts = 0;

      while (pendingAudioChunks.length > 0) {
        const chunk = pendingAudioChunks.shift();
        if (chunk && stt.isConnected()) {
          stt.sendAudio(chunk);
        }
      }
    } catch (err) {
      console.error('[VoiceEngine] STT reconnect failed:', err);
      reconnectSTT();
    }
  }

  function handleTTSEvent(event: TTSEvent) {
    switch (event.type) {
      case 'started':
        setVoiceState('speaking');
        callbacks.onSpeechStarted?.(event.text);
        break;

      case 'chunk':
        audioOutputListeners.forEach((cb) => {
          cb(event.chunk);
        });
        callbacks.onAudioOutput?.(event.chunk);
        break;

      case 'completed':
        setVoiceState('idle');
        callbacks.onSpeechStopped?.(true);
        break;

      case 'stopped':
        setVoiceState('idle');
        callbacks.onSpeechStopped?.(false);
        break;

      case 'error':
        callbacks.onError?.(event.error);
        setVoiceState('idle');
        break;
    }
  }

  async function ensureSTTConnected() {
    if (stt.isConnected()) {
      return;
    }

    console.log('[VoiceEngine] Connecting STT...');
    const connectConfig: { language?: string; vad?: typeof vad } = {};
    if (config.voice.language) {
      connectConfig.language = config.voice.language;
    }
    console.log(
      '[VoiceEngine] STT connect config:',
      JSON.stringify(connectConfig),
    );
    try {
      await stt.connect(connectConfig);
      console.log(`[VoiceEngine] STT connected: ${stt.isConnected()}`);
      if (!sttUnsubscribe) {
        sttUnsubscribe = stt.onEvent(handleSTTEvent);
      }
    } catch (err) {
      console.error('[VoiceEngine] STT connection failed:', err);
      throw err;
    }
  }

  async function ensureTTSConnected() {
    if (tts.isConnected()) {
      return;
    }

    console.log('[VoiceEngine] Connecting TTS...');
    try {
      await tts.connect();
      console.log(`[VoiceEngine] TTS connected: ${tts.isConnected()}`);
      if (!ttsUnsubscribe) {
        ttsUnsubscribe = tts.onEvent(handleTTSEvent);
      }
    } catch (err) {
      console.error('[VoiceEngine] TTS connection failed:', err);
      throw err;
    }
  }

  async function initializeProviders() {
    console.log('[VoiceEngine] Initializing providers...');
    await Promise.all([ensureSTTConnected(), ensureTTSConnected()]);
    console.log('[VoiceEngine] Providers initialized');
  }

  function cleanupProviders() {
    sttUnsubscribe?.();
    ttsUnsubscribe?.();
    stt.disconnect().catch(() => {});
    tts.disconnect().catch(() => {});
  }

  async function startListening(): Promise<void> {
    if (state === 'listening') {
      return;
    }

    if (startListeningPromise) {
      return startListeningPromise;
    }

    if (state !== 'idle' && state !== 'speaking' && state !== 'processing') {
      throw new Error(`Cannot start listening in state: ${state}`);
    }

    startListeningPromise = (async () => {
      // Cancel any pending auto-restart
      if (autoRestartTimeout) {
        clearTimeout(autoRestartTimeout);
        autoRestartTimeout = null;
      }

      isInitializing = true;
      await initializeProviders();
      hasReceivedSpeech = false;
      hasEmittedFinal = false;
      currentTranscript = '';
      accumulatedTranscript = '';
      setVoiceState('listening');

      const bufferedCount = pendingAudioChunks.length;
      if (bufferedCount > 0) {
        console.log(
          `[VoiceEngine] Flushing ${bufferedCount} buffered audio chunks`,
        );
      }
      console.log(
        `[VoiceEngine] startListening complete: state=${state}, sttConnected=${stt.isConnected()}`,
      );
      while (pendingAudioChunks.length > 0) {
        const chunk = pendingAudioChunks.shift();
        if (chunk && stt.isConnected()) {
          stt.sendAudio(chunk);
        }
      }
    })();

    try {
      await startListeningPromise;
    } finally {
      isInitializing = false;
      startListeningPromise = null;
    }
  }

  async function stopListening(): Promise<void> {
    if (state !== 'listening') {
      return;
    }

    stt.endStream();

    // Clear any pending audio since we're done listening
    pendingAudioChunks.length = 0;

    if (accumulatedTranscript && !hasEmittedFinal) {
      hasEmittedFinal = true;
      const finalResult: TranscriptionResult = {
        text: accumulatedTranscript,
        isFinal: true,
      };
      transcriptListeners.forEach((cb) => {
        cb(finalResult);
      });
      callbacks.onTranscript?.(finalResult);
    }

    // In continuous/auto mode, always transition to processing
    // Only go to idle in push-to-talk mode when no speech received
    if (mode === 'push-to-talk' && !hasReceivedSpeech) {
      setVoiceState('idle');
    } else {
      setVoiceState('processing');
    }
  }

  function interrupt(): void {
    // Cancel auto-restart if interrupting
    if (autoRestartTimeout) {
      clearTimeout(autoRestartTimeout);
      autoRestartTimeout = null;
    }

    if (state === 'speaking') {
      tts.stop();
      setVoiceState('idle');
      callbacks.onSpeechStopped?.(false);
    } else if (state === 'listening') {
      // Interrupt listening and go back to idle
      stt.endStream();
      setVoiceState('idle');
    }
  }

  // Build the return object conditionally to handle optional base engine methods
  const voiceEngine: Engine & VoiceEngine = {
    // Base engine methods
    process: baseEngine.process.bind(baseEngine),

    // Voice engine methods
    getVoiceState: () => state,

    async warmup(): Promise<void> {
      await ensureSTTConnected();
    },

    startListening,

    stopListening,

    interrupt,

    onVoiceStateChange(
      callback: (state: VoiceSessionState) => void,
    ): () => void {
      stateChangeListeners.add(callback);
      return () => stateChangeListeners.delete(callback);
    },

    onTranscript(callback: (result: TranscriptionResult) => void): () => void {
      transcriptListeners.add(callback);
      return () => transcriptListeners.delete(callback);
    },

    onVADEvent(callback: (event: VADEvent) => void): () => void {
      vadListeners.add(callback);
      return () => vadListeners.delete(callback);
    },

    onAudioOutput(callback: (chunk: SpeechChunk) => void): () => void {
      audioOutputListeners.add(callback);
      return () => audioOutputListeners.delete(callback);
    },

    handleVADEvent(event: VADEvent): void {
      vadListeners.forEach((cb) => {
        cb(event);
      });
      callbacks.onVADEvent?.(event);

      if (event.type === 'speech_end' || event.type === 'utterance_end') {
        pendingFinalFromVAD = true;
        if (vadFinalDebounceTimeout) {
          clearTimeout(vadFinalDebounceTimeout);
        }
        vadFinalDebounceTimeout = setTimeout(() => {
          if (pendingFinalFromVAD) {
            emitFinalTranscript();
          }
        }, VAD_FINAL_DEBOUNCE_MS);
      }

      if (event.type === 'speech_start') {
        pendingFinalFromVAD = false;
        if (vadFinalDebounceTimeout) {
          clearTimeout(vadFinalDebounceTimeout);
          vadFinalDebounceTimeout = null;
        }
      }
    },

    shouldAutoRestart(): boolean {
      return (
        (mode === 'continuous' || mode === 'auto') &&
        autoRestartListening &&
        state === 'idle'
      );
    },

    sendAudioChunk(chunk: AudioChunk): void {
      console.log(
        '[VoiceEngine] Received audio chunk:',
        `size=${chunk.data.length}`,
        `state=${state}`,
        `sttConnected=${stt.isConnected()}`,
      );
      if (isInitializing || state === 'idle') {
        if (pendingAudioChunks.length < MAX_PENDING_CHUNKS) {
          pendingAudioChunks.push(chunk);
          if (pendingAudioChunks.length % 10 === 1) {
            console.log(
              `[VoiceEngine] Buffering audio: ${pendingAudioChunks.length} chunks (state=${state}, init=${isInitializing})`,
            );
          }
        }
        return;
      }

      if (state === 'listening') {
        if (stt.isConnected()) {
          console.log(
            '[VoiceEngine] Sending audio chunk to STT: size=',
            chunk.data.length,
          );
          stt.sendAudio(chunk);
        } else {
          if (pendingAudioChunks.length < MAX_PENDING_CHUNKS) {
            pendingAudioChunks.push(chunk);
          }
          if (reconnectAttempts === 0) {
            console.log(
              '[VoiceEngine] STT disconnected, triggering reconnect...',
            );
            reconnectSTT();
          }
        }
      } else {
        console.warn(
          `[VoiceEngine] Dropping audio: state=${state}, sttConnected=${stt.isConnected()}`,
        );
      }
    },

    /** Speak text using TTS provider */
    async speak(text: string, voice?: string): Promise<void> {
      if (state === 'speaking') {
        tts.stop();
      }

      if (!tts.isConnected()) {
        await tts.connect();
        ttsUnsubscribe = tts.onEvent(handleTTSEvent);
      }

      const speakOptions: { voice?: string } = {};
      if (voice) {
        speakOptions.voice = voice;
      }
      tts.speak(text, speakOptions);
    },

    /** Process voice input and return response */
    async processVoiceInput(
      request: Omit<ChartRequest, 'context'> & {
        context: Omit<ChartRequest['context'], 'updateReasons'> & {
          updateReasons: Array<{
            type: 'user_intent';
            intent: string;
          }>;
        };
      },
    ): Promise<MaelstromResponse> {
      // Wait for final transcription if still listening
      if (state === 'listening') {
        await new Promise<void>((resolve) => {
          const checkTranscript = setInterval(() => {
            if (state !== 'listening') {
              clearInterval(checkTranscript);
              resolve();
            }
          }, 100);
        });
      }

      // Update request with transcribed text
      const updatedRequest: ChartRequest = {
        ...request,
        context: {
          ...request.context,
          updateReasons: [
            {
              type: 'user_intent',
              intent: currentTranscript,
            },
          ],
        },
      };

      // Process with base engine
      const response = await baseEngine.process(updatedRequest);

      // Reset transcript for next turn
      currentTranscript = '';
      hasReceivedSpeech = false;

      return response;
    },

    destroy(): void {
      if (autoRestartTimeout) {
        clearTimeout(autoRestartTimeout);
      }
      if (vadFinalDebounceTimeout) {
        clearTimeout(vadFinalDebounceTimeout);
      }
      cleanupProviders();
      stateChangeListeners.clear();
      transcriptListeners.clear();
      vadListeners.clear();
      audioOutputListeners.clear();
    },
  };

  // Conditionally add optional base engine methods
  if (baseEngine.clearSessionHistory) {
    (voiceEngine as Engine & VoiceEngine).clearSessionHistory =
      baseEngine.clearSessionHistory.bind(baseEngine);
  }
  if (baseEngine.addAssistantMessage) {
    (voiceEngine as Engine & VoiceEngine).addAssistantMessage =
      baseEngine.addAssistantMessage.bind(baseEngine);
  }

  return voiceEngine;
}

/**
 * Type guard to check if an engine is voice-enabled.
 */
export function isVoiceEngine(engine: Engine): engine is Engine & VoiceEngine {
  return 'getVoiceState' in engine;
}
