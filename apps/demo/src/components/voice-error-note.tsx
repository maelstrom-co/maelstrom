import {
  RealtimeVoiceError,
  type RealtimeVoiceErrorCode,
} from '@maelstrom-co/realtime';
import { m } from '../lib/maelstrom';

const CONNECTION_DROPPED_MESSAGE =
  'Voice connection dropped. Click the orb to reconnect.';

const MESSAGE_BY_CODE: Partial<Record<RealtimeVoiceErrorCode, string>> = {
  MIC_PERMISSION_DENIED:
    "Microphone access is blocked. Allow the mic in your browser's site settings, then click the orb to retry.",
  TOKEN_MINT_FAILED:
    "Voice couldn't start — the server couldn't mint a session token. Check the server logs or configuration, then try again.",
  CONNECTION_FAILED: CONNECTION_DROPPED_MESSAGE,
  DATA_CHANNEL_ERROR: CONNECTION_DROPPED_MESSAGE,
};

const FALLBACK_MESSAGE = 'Voice error. Click the orb to retry.';

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
  const message = (code && MESSAGE_BY_CODE[code]) ?? FALLBACK_MESSAGE;

  return (
    <div
      role="alert"
      className="voice-error-note mx-auto mb-2 max-w-md rounded-md border border-pink/30 bg-pink/10 px-3 py-1.5 text-center text-xs text-pink"
    >
      {message}
    </div>
  );
}
