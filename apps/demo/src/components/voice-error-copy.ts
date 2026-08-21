import { RealtimeVoiceError } from '@maelstrom-co/realtime';

const REALTIME_SETUP_STATUS =
  /^OpenAI realtime call setup failed with status (\d{3})$/;

export function getVoiceErrorStatusLabel(error: unknown): string {
  if (!(error instanceof RealtimeVoiceError)) return 'Voice error';

  if (error.code === 'MIC_PERMISSION_DENIED') return 'Microphone blocked';
  if (error.code === 'TOKEN_MINT_FAILED') return 'Voice token failed';
  if (error.code === 'DATA_CHANNEL_ERROR') return 'Voice channel failed';
  if (error.code !== 'CONNECTION_FAILED') return 'Voice error';

  const status = REALTIME_SETUP_STATUS.exec(error.message)?.[1];
  return status
    ? `OpenAI voice failed (HTTP ${status})`
    : 'Voice connection failed';
}

export function getVoiceErrorMessage(error: unknown): string {
  if (!(error instanceof RealtimeVoiceError)) {
    return 'Voice error. Click the orb to retry.';
  }

  if (error.code === 'MIC_PERMISSION_DENIED') {
    return "Microphone access is blocked. Allow the mic in your browser's site settings, then click the orb to retry.";
  }
  if (error.code === 'TOKEN_MINT_FAILED') {
    return "Voice couldn't start because a session token could not be created. Check the key or server configuration, then retry.";
  }
  if (error.code === 'DATA_CHANNEL_ERROR') {
    return 'The voice channel failed. Click the orb to reconnect.';
  }
  if (error.code !== 'CONNECTION_FAILED') {
    return 'Voice error. Click the orb to retry.';
  }

  const status = REALTIME_SETUP_STATUS.exec(error.message)?.[1];
  if (status === '403') {
    return "OpenAI denied Realtime access (HTTP 403). Check the key's project permissions and model access, then retry.";
  }
  if (status === '429') {
    return "OpenAI rate-limited voice setup (HTTP 429). Check the API project's usage limits, then retry.";
  }
  if (status) {
    return `OpenAI rejected voice setup (HTTP ${status}). Click the orb to retry.`;
  }
  if (error.message === 'OpenAI realtime call setup request failed') {
    return 'Could not reach OpenAI for voice setup. Check the connection, then retry.';
  }
  return 'Voice connection failed. Click the orb to reconnect.';
}
