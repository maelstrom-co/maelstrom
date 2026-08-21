import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { usesBrowserOpenAIVoice } from '../lib/hosted-mode';
import { m } from '../lib/maelstrom';
import { getVoiceErrorMessage } from './voice-error-copy';

/**
 * Actionable recovery guidance shown as a slim toast above the voice orb
 * when the shared voice session lands in `error`. The message varies by
 * `RealtimeVoiceError` code so the user knows whether to grant mic access,
 * check server config, or just retry; disappears once state leaves `error`.
 */
export function VoiceErrorNote() {
  const { state, error } = m.useVoice();

  if (state !== 'error') return null;

  const code = error instanceof RealtimeVoiceError ? error.code : null;

  // An OpenAI browser-key mint failure reopens the drawer with the provider's
  // reason. LiveKit failures still need the server-configuration guidance
  // below because an OpenAI key cannot resolve them.
  if (code === 'TOKEN_MINT_FAILED' && usesBrowserOpenAIVoice()) return null;

  const message = getVoiceErrorMessage(error);

  return (
    <div
      role="alert"
      className="voice-error-note mx-auto mb-2 max-w-md rounded-md border border-pink/30 bg-pink/10 px-3 py-1.5 text-center text-xs text-pink"
    >
      {message}
    </div>
  );
}
