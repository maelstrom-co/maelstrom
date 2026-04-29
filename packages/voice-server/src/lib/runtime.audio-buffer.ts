import type { AudioChunk, STTProvider } from './types.js';
import type { VoiceRuntimeState } from './runtime.state.js';

export function flushBufferedAudio(
  state: VoiceRuntimeState,
  stt: STTProvider,
  trace: (event: string, details?: Record<string, unknown>) => void,
  reportError: (error: unknown) => void,
  traceEvent: string,
) {
  function traceFlushStopped(
    reason: 'stt_disconnected' | 'state_changed',
    chunk: AudioChunk,
  ) {
    trace('stt.buffered_audio.flush_stopped', {
      reason,
      state: state.state,
      nextBufferedAudioSequence: chunk.sequence ?? null,
      nextBufferedAudioTimestamp: chunk.timestamp,
      pendingBufferedAudioChunks: state.pendingAudioChunks.length,
    });
  }

  while (state.pendingAudioChunks.length > 0) {
    const chunk = state.pendingAudioChunks[0];

    if (!chunk) {
      const error = new Error(
        'Buffered STT audio flush lost track of the next queued chunk',
      );
      trace('stt.buffered_audio.flush_failed', {
        reason: 'queue_corrupted',
        state: state.state,
        pendingBufferedAudioChunks: state.pendingAudioChunks.length,
        message: error.message,
      });
      reportError(error);
      return;
    }

    if (state.state !== 'listening') {
      traceFlushStopped('state_changed', chunk);
      return;
    }

    if (!stt.isConnected()) {
      traceFlushStopped('stt_disconnected', chunk);
      return;
    }

    try {
      trace(traceEvent, {
        bytes: chunk.data.length,
        sampleRate: chunk.sampleRate,
        encoding: chunk.encoding,
        remainingBufferedAudioChunks: state.pendingAudioChunks.length - 1,
      });
      stt.sendAudio(chunk);
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      trace('stt.buffered_audio.flush_failed', {
        reason: 'send_failed',
        state: state.state,
        pendingBufferedAudioChunks: state.pendingAudioChunks.length,
        nextBufferedAudioSequence: chunk.sequence ?? null,
        nextBufferedAudioTimestamp: chunk.timestamp,
        message: normalizedError.message,
      });
      reportError(
        new Error('Failed to replay buffered STT audio chunk', {
          cause: normalizedError,
        }),
      );
      return;
    }

    if (state.pendingAudioChunks[0] !== chunk) {
      // WHY: The queue is expected to behave like a strict FIFO while replaying. If the head changes
      // under us, some other code path is mutating buffered audio concurrently and replay order can no
      // longer be trusted.
      const error = new Error(
        'Buffered STT audio queue changed while replaying the next chunk',
      );
      trace('stt.buffered_audio.flush_failed', {
        reason: 'queue_mutated',
        state: state.state,
        pendingBufferedAudioChunks: state.pendingAudioChunks.length,
        nextBufferedAudioSequence: chunk.sequence ?? null,
        nextBufferedAudioTimestamp: chunk.timestamp,
        message: error.message,
      });
      reportError(error);
      return;
    }

    state.pendingAudioChunks.shift();
  }
}

export function bufferAudioChunk(
  state: VoiceRuntimeState,
  maxPendingAudioChunks: number,
  reportError: (error: unknown) => void,
  trace: (event: string, details?: Record<string, unknown>) => void,
  chunk: AudioChunk,
  traceEvent: string,
  traceDetails: Record<string, unknown>,
): boolean {
  if (state.pendingAudioChunks.length >= maxPendingAudioChunks) {
    // WHY: Overflow is surfaced as an error instead of silently dropping the oldest chunk because
    // losing early audio often corrupts recognition in a way that is impossible for callers to debug.
    reportError(
      new Error(
        `STT audio buffer overflow: buffered chunk limit (${maxPendingAudioChunks}) reached`,
      ),
    );
    trace('stt.audio.buffer_overflow', {
      ...traceDetails,
      bufferedAudioChunks: state.pendingAudioChunks.length,
      maxPendingAudioChunks,
    });
    return false;
  }

  state.pendingAudioChunks.push(chunk);
  trace(traceEvent, {
    ...traceDetails,
    bufferedAudioChunks: state.pendingAudioChunks.length,
  });
  return true;
}
