/** Fixed demo bridge until gpt-4o-transcribe retires on February 26, 2027. */
export const LIVE_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

/** Dedicated GA transcription configuration; never a conversational session. */
export const LIVE_TRANSCRIPTION_SESSION = {
  type: 'transcription',
  audio: {
    input: {
      transcription: { model: LIVE_TRANSCRIPTION_MODEL },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
    },
  },
} as const;
