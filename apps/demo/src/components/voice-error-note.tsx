import {
  RealtimeVoiceError,
  type RealtimeVoiceErrorCode,
} from '@maelstrom-co/realtime';
import { isHosted } from '../lib/hosted-mode';
import { m } from '../lib/maelstrom';

const CONNECTION_DROPPED_MESSAGE =
  'Voice connection dropped. Click the orb to reconnect.';

// Local mode mints from a server-held OPENAI_API_KEY, so a mint failure
// there really is a server misconfiguration. Hosted/BYOK mode mints
// browser-direct with the visitor's own key — index.tsx's drawer-reopen
// effect already surfaces the actionable "check your key" message there, so
// this note only needs a hosted-aware TOKEN_MINT_FAILED line to avoid
// pointing a BYOK visitor at server env vars they don't control.
const MESSAGE_BY_CODE: Partial<Record<RealtimeVoiceErrorCode, string>> = {
  MIC_PERMISSION_DENIED:
    "Microphone access is blocked. Allow the mic in your browser's site settings, then click the orb to retry.",
  TOKEN_MINT_FAILED:
    "Voice couldn't start — the server couldn't mint a session token. Check the server logs or configuration, then try again.",
  CONNECTION_FAILED: CONNECTION_DROPPED_MESSAGE,
  DATA_CHANNEL_ERROR: CONNECTION_DROPPED_MESSAGE,
};

const HOSTED_TOKEN_MINT_FAILED_MESSAGE =
  "Voice couldn't start with that key. Check it in the key drawer and try again.";

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
  const message =
    code === 'TOKEN_MINT_FAILED' && isHosted()
      ? HOSTED_TOKEN_MINT_FAILED_MESSAGE
      : ((code && MESSAGE_BY_CODE[code]) ?? FALLBACK_MESSAGE);

  return (
    <div
      role="alert"
      className="voice-error-note mx-auto mb-2 max-w-md rounded-md border border-pink/30 bg-pink/10 px-3 py-1.5 text-center text-xs text-pink"
    >
      {message}
    </div>
  );
}
