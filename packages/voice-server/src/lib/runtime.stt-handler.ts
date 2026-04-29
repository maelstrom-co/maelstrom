import type { VoiceRuntimeState } from './runtime.state.js';
import type {
  STTEvent,
  TranscriptionResult,
  VoiceSessionState,
} from './types.js';

export function handleSTTEvent(
  state: VoiceRuntimeState,
  sttName: string,
  trace: (event: string, details?: Record<string, unknown>) => void,
  updateTranscriptState: (result: TranscriptionResult) => void,
  emitFinalTranscript: () => void,
  createForwardedTranscriptResult: (
    result: TranscriptionResult,
  ) => TranscriptionResult,
  forwardTranscriptResult: (result: TranscriptionResult) => void,
  reportError: (error: unknown) => void,
  reconnectSTT: () => Promise<void>,
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
        message: event.error.message,
      });
      reportError(event.error);
      setVoiceState('idle');
      break;

    case 'disconnected':
      trace('stt.disconnected', {
        state: state.state,
        pendingBufferedAudioChunks: state.pendingAudioChunks.length,
      });
      if (state.state === 'listening' || state.state === 'processing') {
        // WHY: We reconnect in both states because the active user turn may still matter even after STT
        // drops. `processing` keeps the transport warm for auto-restart after the spoken reply.
        void reconnectSTT();
      }
      break;

    case 'connected':
      trace('stt.connected', {
        provider: sttName,
      });
      break;
  }
}
