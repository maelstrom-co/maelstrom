import type { VoiceSessionState } from '@maelstrom-co/client';
import { m } from '../lib/maelstrom';

const STATE_LABEL: Record<VoiceSessionState, string> = {
  idle: 'Voice off',
  connecting: 'Connecting…',
  connected: 'Voice on',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  error: 'Voice error',
};

// Every state where the transport is live — mic on, session up.
const CONNECTED_STATES: ReadonlySet<VoiceSessionState> = new Set([
  'connected',
  'listening',
  'thinking',
  'speaking',
]);

/**
 * Provider-agnostic voice control. The orb toggles the shared session; the
 * hold-to-talk button renders only when the active adapter exposes
 * `turnControl` (push-to-talk cascades like LiveKit) and stays absent for
 * speech-native providers that manage turns server-side.
 */
export function VoiceControl() {
  const { state, turnControl } = m.useVoice();
  const isConnected = CONNECTED_STATES.has(state);

  return (
    <div className="flex items-center gap-2">
      <m.VoiceOrb size={20} />
      <span
        className={`text-xs font-medium ${
          state === 'error' ? 'text-red-400' : 'text-gray-300'
        }`}
      >
        {STATE_LABEL[state]}
      </span>
      {turnControl && (
        <button
          type="button"
          disabled={!isConnected}
          onPointerDown={() => void turnControl.startTurn()}
          onPointerUp={() => void turnControl.endTurn()}
          onPointerLeave={() => {
            if (state === 'listening') void turnControl.endTurn();
          }}
          className="text-xs px-3 py-1.5 rounded-full font-medium transition-colors bg-purple-800 hover:bg-purple-700 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed select-none touch-none"
        >
          Hold to talk
        </button>
      )}
    </div>
  );
}
