import type { VoiceSessionState } from '@maelstrom-co/client';
import { m } from '../lib/maelstrom';

const STATE_LABEL: Record<VoiceSessionState, string> = {
  idle: 'LiveKit off',
  connecting: 'Connecting…',
  connected: 'LiveKit on',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'LiveKit error',
};

// Every state where the transport is live — mic on, session up.
const CONNECTED_STATES: ReadonlySet<VoiceSessionState> = new Set([
  'connected',
  'listening',
  'thinking',
  'speaking',
]);

/**
 * LiveKit adapter spike control: a connect toggle plus a hold-to-talk button.
 * Deliberately minimal and clearly labeled — this sits next to the OpenAI
 * `MicToggle` to compare the two providers driving the same session core.
 */
export function LiveKitMic() {
  const { state, connect, disconnect, startTalking, stopTalking } =
    m.useLiveKitVoiceSpike();
  const isConnected = CONNECTED_STATES.has(state);

  const handleToggle = () => {
    if (isConnected) {
      void disconnect();
    } else {
      // Failure lands in `state` ('error') via the adapter's own state
      // transition — this catch only stops the rejection being unhandled.
      void connect().catch(() => {});
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleToggle}
        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
          state === 'error'
            ? 'bg-red-600 hover:bg-red-700'
            : isConnected
              ? 'bg-purple-600 hover:bg-purple-700'
              : 'bg-gray-700 hover:bg-gray-600'
        }`}
      >
        LK: {STATE_LABEL[state]}
      </button>
      <button
        type="button"
        disabled={!isConnected}
        onPointerDown={() => void startTalking()}
        onPointerUp={() => void stopTalking()}
        onPointerLeave={() => {
          if (state === 'listening') void stopTalking();
        }}
        className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors bg-purple-800 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed select-none touch-none"
      >
        Hold to talk
      </button>
    </div>
  );
}
