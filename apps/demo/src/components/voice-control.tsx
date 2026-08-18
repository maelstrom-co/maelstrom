import type { VoiceSessionState } from '@maelstrom-co/client';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
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

const CONNECTED_STATES: ReadonlySet<VoiceSessionState> = new Set([
  'connected',
  'listening',
  'thinking',
  'speaking',
]);

const ACTIVE_STATES: ReadonlySet<VoiceSessionState> = new Set([
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
 * hold-to-talk button renders only in established manual mode when the adapter
 * exposes `turnControl`. An active manual turn is ended before a mode change or
 * disconnect hides the control. Automatic-mode degradation shows generic
 * recovery guidance based only on diagnostic presence; the diagnostic itself
 * is never rendered or serialized. A configured greeting shows indeterminate
 * preparation until it settles, while idle, error, and active-turn labels keep
 * precedence over the preparation label.
 */
export function VoiceControl({ showOrb = true }: VoiceControlProps = {}) {
  const { greetingState, state, turnControl, turnMode, turnModeError } =
    m.useVoice();
  const isConnected = CONNECTED_STATES.has(state);
  const isPreparing =
    greetingState === 'preparing' && state !== 'idle' && state !== 'error';
  let statusLabel = STATE_LABEL[state];
  if (isPreparing && !ACTIVE_STATES.has(state)) {
    statusLabel = 'Preparing voice…';
  } else if (greetingState === 'settled' && state === 'connected') {
    statusLabel = 'Listening';
  }
  // Keep input handlers independent from the latest rendered session state.
  const pressActiveRef = useRef(false);
  const [pressActive, setPressActive] = useState(false);

  const startPress = () => {
    pressActiveRef.current = true;
    setPressActive(true);
    void turnControl?.startTurn();
  };

  const endPress = useCallback(() => {
    if (!pressActiveRef.current) return;
    pressActiveRef.current = false;
    setPressActive(false);
    void turnControl?.endTurn();
  }, [turnControl]);

  // A fatal error can flip the button disabled mid-press, and browsers
  // suppress the pointerup/keyup that would normally reach endPress() on a
  // disabled control. Without this, the stale ref permanently eats the next
  // keydown's guard, even after reconnecting.
  useLayoutEffect(() => {
    if (!isConnected) endPress();
  }, [endPress, isConnected]);

  // Keep the button mounted through this layout cleanup. Clearing the ref
  // makes a stale release harmless after automatic mode takes over.
  useLayoutEffect(() => {
    if (turnMode !== 'manual') endPress();
    return endPress;
  }, [endPress, turnMode]);

  const showManualControl =
    turnControl !== undefined && (turnMode === 'manual' || pressActive);

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
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {showOrb && <m.VoiceOrb size={20} />}
      <div
        aria-live="polite"
        className={`flex min-w-0 items-center gap-2 text-xs font-medium ${
          state === 'error' ? 'text-red-400' : 'text-ink-2'
        }`}
        role="status"
      >
        <span className="min-w-0 truncate">{statusLabel}</span>
        {isPreparing && (
          <span
            aria-label="Voice preparation progress"
            className="h-1 w-16 max-w-[20vw] shrink-0 overflow-hidden rounded-full bg-ink-2/20"
            role="progressbar"
          >
            <span className="block h-full w-1/2 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
          </span>
        )}
      </div>
      {turnMode === 'manual' && turnControl && turnModeError !== undefined && (
        <span className="min-w-0 text-xs text-amber-300">
          Automatic voice detection unavailable; hold to talk.
        </span>
      )}
      {showManualControl && (
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
