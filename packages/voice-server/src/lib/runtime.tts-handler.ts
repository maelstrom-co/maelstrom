import { createTTSError } from './provider-errors.js';
import type {
  VoiceRuntimeListeners,
  VoiceRuntimeState,
} from './runtime.state.js';
import type {
  TTSEvent,
  VoiceSessionCallbacks,
  VoiceSessionState,
} from './types.js';

type NotifyListenersSafely = <T>(
  listeners: Set<(value: T) => void>,
  value: T,
  traceEvent: string,
) => void;

type NotifyCallbackSafely = <T extends unknown[]>(
  callback: ((...args: T) => void) | undefined,
  traceEvent: string,
  ...args: T
) => void;

export function handleTTSEvent(
  state: VoiceRuntimeState,
  listeners: VoiceRuntimeListeners,
  callbacks: VoiceSessionCallbacks,
  ttsName: string,
  trace: (event: string, details?: Record<string, unknown>) => void,
  notifyListenersSafely: NotifyListenersSafely,
  notifyCallbackSafely: NotifyCallbackSafely,
  reportError: (error: unknown) => void,
  setVoiceState: (state: VoiceSessionState) => void,
  event: TTSEvent,
) {
  switch (event.type) {
    case 'started':
      trace('tts.started', {
        textLength: event.speech.text.length,
        preview: event.speech.text.slice(0, 80),
        format: event.speech.format,
        sampleRate: event.speech.sampleRate,
      });
      setVoiceState('speaking');
      notifyCallbackSafely(
        callbacks.onSpeechStarted,
        'callback.onSpeechStarted.failed',
        event.speech,
      );
      break;
    case 'chunk':
      trace('tts.chunk.received', {
        bytes: event.chunk.data.length,
        format: event.chunk.format,
        sampleRate: event.chunk.sampleRate,
        sequence: event.chunk.sequence,
        isFinal: event.chunk.isFinal,
        listenerCount: listeners.audioOutput.size,
        hasOnAudioOutputCallback: Boolean(callbacks.onAudioOutput),
      });
      notifyListenersSafely(
        listeners.audioOutput,
        event.chunk,
        'callback.onAudioOutputListener.failed',
      );
      // WHY: Tracing after listener delivery makes the trace reflect the package boundary, not merely
      // provider receipt. That matters when debugging adapters that consume chunks synchronously.
      trace('tts.chunk.forwarded', {
        bytes: event.chunk.data.length,
        sequence: event.chunk.sequence,
        isFinal: event.chunk.isFinal,
      });
      notifyCallbackSafely(
        callbacks.onAudioOutput,
        'callback.onAudioOutput.failed',
        event.chunk,
      );
      break;
    case 'completed':
      trace('tts.completed');
      setVoiceState('idle');
      notifyCallbackSafely(
        callbacks.onSpeechStopped,
        'callback.onSpeechStopped.failed',
        true,
      );
      break;
    case 'stopped':
      trace('tts.stopped');
      setVoiceState('idle');
      notifyCallbackSafely(
        callbacks.onSpeechStopped,
        'callback.onSpeechStopped.failed',
        false,
      );
      break;
    case 'error':
      trace('tts.error', {
        kind: event.error.kind,
        message: event.error.message,
        provider: event.error.provider,
      });
      reportError(event.error);
      setVoiceState('idle');
      break;
    case 'connected':
      trace('tts.connected', {
        provider: ttsName,
      });
      break;
    case 'disconnected':
      trace('tts.disconnected', {
        provider: ttsName,
      });
      if (state.state === 'speaking') {
        // WHY: A mid-turn TTS disconnect is observable user-facing failure, not an ignorable transport
        // blip. The runtime treats it like an interrupted reply so callers can recover cleanly.
        reportError(
          createTTSError(
            ttsName,
            'transport',
            'TTS disconnected while speaking',
          ),
        );
        setVoiceState('idle');
        notifyCallbackSafely(
          callbacks.onSpeechStopped,
          'callback.onSpeechStopped.failed',
          false,
        );
      }
      break;
  }
}
