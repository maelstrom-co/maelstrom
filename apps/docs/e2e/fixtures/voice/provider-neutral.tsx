import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import {
  type RealtimeProviderAdapter,
  RealtimeVoiceError,
} from '@maelstrom-co/realtime';
import { useState } from 'react';

const statusVessel = defineVessel({
  id: 'status',
  name: 'Status',
  description: 'Shows application status',
  defaultVariant: 'summary',
  variants: {
    summary: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});
const vessels = [vessel(statusVessel, () => null)] as const;
declare const createAdapter: (
  context: CreateAdapterContext,
) => RealtimeProviderAdapter;

/* docs:provider-neutral-setup:start */
export const m = createMaelstrom({ vessels }).with(
  maelstromRealtime({ createAdapter }),
);
/* docs:provider-neutral-setup:end */

/**
 * Maps every currently published fatal voice code to bounded recovery copy.
 * Unknown failures get a generic message without exposing provider details.
 */
function voiceErrorCopy(error: unknown): string {
  if (!(error instanceof RealtimeVoiceError)) {
    return 'Voice stopped unexpectedly. Reconnect voice to continue.';
  }

  switch (error.code) {
    case 'MIC_PERMISSION_DENIED':
      return 'Allow microphone access, then reconnect voice.';
    case 'TOKEN_MINT_FAILED':
      return 'Voice credentials could not be issued. Check the voice server before reconnecting.';
    case 'CONNECT_SUPERSEDED':
      return 'A newer connection attempt replaced this one. Check the current voice status.';
    case 'CONNECTION_FAILED':
    case 'DATA_CHANNEL_ERROR':
    case 'ALREADY_CONNECTED':
      return 'The voice connection failed. Reconnect voice to continue.';
  }
}

/**
 * Renders the common session controls without assuming a provider-specific
 * state order or retry policy. Connection operations report bounded local
 * failures; typed fatal session failures remain available through `error`.
 */
/* docs:provider-neutral-controls:start */
export function VoiceControls() {
  const {
    state,
    error,
    userTranscript,
    assistantTranscript,
    connect,
    disconnect,
    turnControl,
  } = m.useVoice();
  const [operationError, setOperationError] = useState<string>();
  const connected =
    state !== 'idle' && state !== 'connecting' && state !== 'error';
  const alertCopy =
    operationError ?? (error === undefined ? undefined : voiceErrorCopy(error));

  async function toggleVoice() {
    setOperationError(undefined);
    try {
      if (connected) await disconnect();
      else await connect();
    } catch {
      setOperationError(
        'Voice could not change connection state. Check the status before trying again.',
      );
    }
  }

  return (
    <section>
      <m.VoiceOrb />
      <p>Voice status: {state}</p>
      <button
        type="button"
        disabled={state === 'connecting'}
        onClick={toggleVoice}
      >
        {connected ? 'Disconnect voice' : 'Connect voice'}
      </button>
      {turnControl && <p>This provider requires explicit turn controls.</p>}
      {userTranscript && <p>You: {userTranscript.text}</p>}
      {assistantTranscript && <p>Assistant: {assistantTranscript.text}</p>}
      {alertCopy && <p role="alert">{alertCopy}</p>}
    </section>
  );
}
/* docs:provider-neutral-controls:end */
