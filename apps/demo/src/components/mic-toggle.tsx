import { m } from '../lib/maelstrom';

const STATE_LABEL: Record<string, string> = {
  idle: 'Start voice',
  connecting: 'Connecting…',
  connected: 'Voice on',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Voice error',
};

// Every state where the transport is live — mic on, session up.
const CONNECTED_STATES = new Set(['connected', 'listening', 'thinking', 'speaking']);

/**
 * Mic toggle for the realtime voice spike. Calls
 * `session.connect()`/`disconnect()` and reflects `session.state`.
 */
export function MicToggle() {
  const { state, connect, disconnect } = m.useVoiceSpike();
  const isConnected = CONNECTED_STATES.has(state);

  const handleClick = () => {
    if (isConnected) {
      void disconnect();
    } else {
      // Failure already lands in `state` ('error') via the session's own
      // state transition — this catch only exists so the rejection isn't
      // unhandled.
      void connect().catch(() => {});
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
        state === 'error'
          ? 'bg-red-600 hover:bg-red-700'
          : isConnected
            ? 'bg-green-600 hover:bg-green-700'
            : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      {STATE_LABEL[state] ?? state}
    </button>
  );
}
