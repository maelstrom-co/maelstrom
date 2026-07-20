import type { VoiceSessionState } from '@maelstrom-co/client';

// OpenAI emits response.done before output audio finishes draining, and
// response.created can arrive while the user is still talking (server VAD
// races). Both cases return null so the louder signal (speech / audio
// buffer events) keeps owning the state.
export function deriveVoiceActivity(
  prev: VoiceSessionState,
  rawEventType: string,
): VoiceSessionState | null {
  switch (rawEventType) {
    case 'input_audio_buffer.speech_started':
      return 'listening';
    case 'input_audio_buffer.speech_stopped':
      return 'thinking';
    case 'response.created':
      return prev === 'listening' ? null : 'thinking';
    case 'output_audio_buffer.started':
      return 'speaking';
    case 'output_audio_buffer.stopped':
    case 'output_audio_buffer.cleared':
      // During a barge-in these fire while the user is still talking
      // (speech_started already moved state to 'listening') — only
      // speech_stopped may end a listening turn.
      return prev === 'listening' ? null : 'connected';
    case 'response.done':
    case 'response.cancelled':
      return prev === 'speaking' || prev === 'listening' ? null : 'connected';
    default:
      return null;
  }
}
