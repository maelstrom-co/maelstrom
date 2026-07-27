import type { VoiceSessionState } from '@maelstrom-co/client';
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
} from 'react';
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

interface VoiceControlProps {
  /**
   * Render the orb inline. The launch shell already shows a hero orb next to
   * the intent input, so it mounts this control with `showOrb={false}` to keep
   * the status label and hold-to-talk affordance without a second orb.
   */
  readonly showOrb?: boolean;
}

/**
 * Provider-agnostic voice control. The orb toggles the shared session; the
 * hold-to-talk button renders only when the active adapter exposes
 * `turnControl` (push-to-talk cascades like LiveKit) and stays absent for
 * speech-native providers that manage turns server-side.
 */
export function VoiceControl({ showOrb = true }: VoiceControlProps = {}) {
  const { state, turnControl } = m.useVoice();
  const isConnected = CONNECTED_STATES.has(state);
  // Single source of truth for "this press owns an active turn" — both the
  // pointer and keyboard handlers below read/clear it, so a state re-render
  // racing the pointer leaving the button (state still a stale snapshot)
  // never leaves the mic stuck open, and the two input modalities can't
  // double-start or double-end the same turn.
  const pressActiveRef = useRef(false);

  const startPress = () => {
    pressActiveRef.current = true;
    void turnControl?.startTurn();
  };

  const endPress = () => {
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    void turnControl?.endTurn();
  };

  // A fatal error can flip the button disabled mid-press, and browsers
  // suppress the pointerup/keyup that would normally reach endPress() on a
  // disabled control. Without this, the stale ref permanently eats the next
  // keydown's guard, even after reconnecting.
  useEffect(() => {
    if (!isConnected) endPress();
  }, [isConnected]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat || pressActiveRef.current) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    // Space's default action scrolls the page; Enter's would submit/click.
    e.preventDefault();
    startPress();
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    endPress();
  };

  return (
    <div className="flex items-center gap-2">
      {showOrb && <m.VoiceOrb size={20} />}
      <span
        className={`text-xs font-medium ${
          state === 'error' ? 'text-red-400' : 'text-ink-2'
        }`}
      >
        {STATE_LABEL[state]}
      </span>
      {turnControl && (
        <button
          type="button"
          disabled={!isConnected}
          onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            startPress();
          }}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onPointerCancel={endPress}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          className="status-pill flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-[.1em] text-ink-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none touch-none"
        >
          Hold to talk
        </button>
      )}
    </div>
  );
}
