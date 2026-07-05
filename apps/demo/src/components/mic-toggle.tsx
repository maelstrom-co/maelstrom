import { m } from '../lib/maelstrom';

const STATE_LABEL: Record<string, string> = {
  idle: 'Start voice',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Voice error',
};

/**
 * Mic toggle for the MAE-300 realtime voice spike. Calls
 * `session.connect()`/`disconnect()` and reflects `session.state`.
 * Unverified live — see task-9-report.md for validation steps.
 */
export function MicToggle() {
  const { state, connect, disconnect } = m.useVoiceSpike();
  const isConnected = state !== 'idle' && state !== 'error';

  const handleClick = () => {
    if (isConnected) {
      void disconnect();
    } else {
      void connect();
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
