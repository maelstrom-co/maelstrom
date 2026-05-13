import type { STTReconnectTrigger } from './runtime.reconnect.js';
import type { VoiceRuntimeState } from './runtime.state.js';
import type {
  STTEvent,
  TranscriptionResult,
  VoiceDisconnectedEvent,
  VoiceSessionState,
} from './types.js';

type STTDisconnectedEvent = VoiceDisconnectedEvent;

function isReconnectableState(state: VoiceSessionState): boolean {
  return state === 'listening' || state === 'processing';
}

function isDisconnectedEvent(event: STTEvent): event is STTDisconnectedEvent {
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

function isRecoverableIdleDisconnect(event: STTDisconnectedEvent): boolean {
  if (!event.clean) {
    return false;
  }

  const normalizedMessage = event.message.trim().toLowerCase();

  return (
    normalizedMessage.includes('idle') ||
    normalizedMessage.includes('inactivity') ||
    normalizedMessage.includes('no audio') ||
    normalizedMessage.includes('timeout')
  );
}

export function handleSTTEvent(
  state: VoiceRuntimeState,
  _sttName: string,
  trace: (event: string, details?: Record<string, unknown>) => void,
  updateTranscriptState: (result: TranscriptionResult) => void,
  emitFinalTranscript: () => void,
  createForwardedTranscriptResult: (
    result: TranscriptionResult,
  ) => TranscriptionResult,
  forwardTranscriptResult: (result: TranscriptionResult) => void,
  reportError: (error: unknown) => void,
  reconnectSTT: (trigger: STTReconnectTrigger) => Promise<void>,
  setVoiceState: (state: VoiceSessionState) => void,
  event: STTEvent,
) {
  switch (event.type) {
    case 'transcript': {
      const transcriptText = event.result.text.trim();
      trace('stt.transcript.received', {
        textLength: transcriptText.length,
        preview: transcriptText.slice(0, 80),
        isFinal: event.result.isFinal,
        confidence: event.result.confidence ?? null,
        language: event.result.language ?? null,
        durationInSeconds: event.result.durationInSeconds ?? null,
        pendingFinalFromVAD: state.pendingFinalFromVAD,
      });
      if (!transcriptText) break;

      if (state.state === 'idle' || state.hasEmittedFinal) {
        trace('stt.transcript.ignored_after_turn_closed', {
          textLength: transcriptText.length,
          preview: transcriptText.slice(0, 80),
          isFinal: event.result.isFinal,
          state: state.state,
          pendingFinalFromVAD: state.pendingFinalFromVAD,
          hasEmittedFinal: state.hasEmittedFinal,
        });
        break;
      }

      updateTranscriptState({
        ...event.result,
        text: transcriptText,
      });

      if (state.pendingFinalFromVAD) {
        // WHY: Once the client has declared the turn ended, the next provider transcript flush should
        // immediately drive finalization so we do not leak one extra interim event after the boundary.
        emitFinalTranscript();
        break;
      }

      forwardTranscriptResult(
        createForwardedTranscriptResult({
          ...event.result,
          text: transcriptText,
        }),
      );
      break;
    }

    case 'error':
      trace('stt.error', {
        kind: event.error.kind,
        message: event.error.message,
        provider: event.error.provider,
      });
      reportError(event.error);

      if (!isReconnectableState(state.state)) {
        setVoiceState('idle');
        break;
      }

      if (event.error.kind === 'auth' || event.error.kind === 'quota') {
        setVoiceState('idle');
        break;
      }

      void reconnectSTT({
        type: 'error',
        error: event.error,
      });
      break;

    case 'disconnected': {
      if (!isDisconnectedEvent(event)) {
        break;
      }

      trace('stt.disconnected', {
        state: state.state,
        clean: event.clean,
        pendingBufferedAudioMs: state.pendingAudioDurationMs,
      });
      if (
        isReconnectableState(state.state) &&
        (event.clean === false || isRecoverableIdleDisconnect(event))
      ) {
        // WHY: We reconnect in both states because the active user turn may still matter even after STT
        // drops. `processing` keeps the transport warm for auto-restart after the spoken reply.
        void reconnectSTT({
          type: 'disconnected',
          clean: false,
          message: event.message,
        });
      }
      break;
    }
  }
}
