import { createTTSError } from './provider-errors.js';
import type {
  VoiceRuntimeListeners,
  VoiceRuntimeState,
} from './runtime.state.js';
import type {
  TTSEvent,
  VoiceDisconnectedEvent,
  VoiceSessionCallbacks,
} from './types.js';

type TTSDisconnectedEvent = VoiceDisconnectedEvent;

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

function isDisconnectedEvent(event: TTSEvent): event is TTSDisconnectedEvent {
  return (
    event.type === 'disconnected' &&
    'clean' in event &&
    'reason' in event &&
    'message' in event &&
    typeof event.clean === 'boolean' &&
    typeof event.reason === 'string' &&
    typeof event.message === 'string'
  );
}

export function handleTTSEvent(
  state: VoiceRuntimeState,
  listeners: VoiceRuntimeListeners,
  callbacks: VoiceSessionCallbacks,
  ttsName: string,
  trace: (event: string, details?: Record<string, unknown>) => void,
  notifyListenersSafely: NotifyListenersSafely,
  notifyCallbackSafely: NotifyCallbackSafely,
  reportError: (error: unknown) => void,
  handleInterruptedSpeech: () => void,
  event: TTSEvent,
) {
  switch (event.type) {
    case 'chunk':
      trace('tts.chunk.received', {
        bytes: event.chunk.data.length,
        format: event.chunk.format,
        sampleRate: event.chunk.sampleRate,
        sequence: event.chunk.sequence,
        isFinal: event.chunk.isFinal,
        listenerCount: listeners.audioOutput.size,
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
    case 'error':
      trace('tts.error', {
        kind: event.error.kind,
        message: event.error.message,
        provider: event.error.provider,
      });
      reportError(event.error);
      handleInterruptedSpeech();
      break;
    case 'disconnected':
      if (!isDisconnectedEvent(event)) {
        break;
      }

      trace('tts.disconnected', {
        provider: ttsName,
        clean: event.clean,
        message: event.message,
      });
      if (state.state === 'speaking') {
        if (!event.clean) {
          reportError(
            createTTSError(ttsName, 'transport', event.message, event),
          );
        }
        handleInterruptedSpeech();
      }
      break;
  }
}
