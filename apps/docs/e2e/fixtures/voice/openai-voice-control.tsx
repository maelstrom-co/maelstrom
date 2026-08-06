import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import { useState } from 'react';

const statusVessel = defineVessel({
  id: 'status',
  name: 'Status',
  description: 'Shows application status',
  defaultVariant: 'summary',
  variants: {
    summary: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
  },
});
const vessels = [vessel(statusVessel, () => null)] as const;
declare const createAdapter: (
  context: CreateAdapterContext,
) => RealtimeProviderAdapter;

const m = createMaelstrom({ vessels }).with(
  maelstromRealtime({ createAdapter }),
);

/* docs:openai-voice-control:start */
export function VoiceControl() {
  const {
    state,
    error,
    userTranscript,
    assistantTranscript,
    connect,
    disconnect,
  } = m.useVoice();
  const [operationFailed, setOperationFailed] = useState(false);
  const canStart = state === 'idle' || state === 'error';
  const hasFailure = operationFailed || error !== undefined;

  return (
    <section aria-label="Voice controls">
      <button
        type="button"
        disabled={state === 'connecting'}
        aria-describedby={hasFailure ? 'voice-error' : undefined}
        onClick={() => {
          setOperationFailed(false);
          // connect() and disconnect() both reject on failure. A rejected
          // disconnect must stay visible, so the user can retry cleanup.
          void (canStart ? connect() : disconnect()).catch(() => {
            setOperationFailed(true);
          });
        }}
      >
        {canStart ? 'Start voice' : 'Stop voice'}
      </button>
      <p>Voice: {state}</p>
      {userTranscript && <p>You: {userTranscript.text}</p>}
      {assistantTranscript && <p>Assistant: {assistantTranscript.text}</p>}
      {hasFailure && (
        <div id="voice-error" role="alert">
          Voice is unavailable.{' '}
          {canStart
            ? 'Select Start voice to retry.'
            : 'Select Stop voice to retry cleanup.'}
        </div>
      )}
    </section>
  );
}
/* docs:openai-voice-control:end */
