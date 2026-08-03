import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import {
  type CreateAdapterContext,
  maelstromRealtime,
} from '@maelstrom-co/react-realtime';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';

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

/* docs:livekit-session-state:start */
import type { VoiceSessionState } from '@maelstrom-co/client';

const STATE_LABEL: Record<VoiceSessionState, string> = {
  idle: 'Voice off',
  connecting: 'Connecting',
  connected: 'Voice on',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Voice unavailable',
};

export function VoiceStatus() {
  const {
    state,
    error,
    userTranscript,
    assistantTranscript,
    turnMode,
    turnModeError,
  } = m.useVoice();

  // Manual mode is either how you configured the adapter or where it landed
  // after automatic detection failed to start. turnModeError is set only in the
  // second case, so it is the one signal that explains why a hold-to-talk
  // button just appeared in a session that was meant to listen on its own.
  const degraded = turnMode === 'manual' && turnModeError !== undefined;

  return (
    <section aria-label="Voice status">
      <p>{STATE_LABEL[state]}</p>
      {degraded && (
        <p role="status">
          Automatic voice detection is unavailable. Hold to talk instead.
        </p>
      )}
      {userTranscript && <p>You: {userTranscript.text}</p>}
      {assistantTranscript && <p>Assistant: {assistantTranscript.text}</p>}
      {error !== undefined && (
        <p role="alert">Voice stopped. Start voice again to reconnect.</p>
      )}
    </section>
  );
}
/* docs:livekit-session-state:end */
