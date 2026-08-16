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
    greetingState,
    error,
    userTranscript,
    assistantTranscript,
    connect,
    disconnect,
  } = m.useVoice();
  const [operationFailed, setOperationFailed] = useState(false);
  const canStart = state === 'idle' || state === 'error';
  const hasFailure = operationFailed || error !== undefined;
  const isPreparingGreeting = greetingState === 'preparing';
  const voiceLabel = isPreparingGreeting
    ? 'Preparing voice…'
    : state === 'connected'
      ? 'Listening'
      : `Voice: ${state}`;

  return (
    <section aria-label="Voice controls">
      <button
        type="button"
        aria-describedby={hasFailure ? 'voice-error' : undefined}
        aria-busy={isPreparingGreeting}
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
      <p>{voiceLabel}</p>
      {isPreparingGreeting && <progress aria-label="Preparing voice" />}
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
