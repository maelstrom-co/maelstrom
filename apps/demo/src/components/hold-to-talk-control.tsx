import type { VoiceSessionState } from '@maelstrom-co/client';
import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { isVoiceConnected } from '../lib/voice-session-state';

// An active press is ended before a disconnect, a mode change or an unmount
// hides the button, so the adapter never keeps a turn open with no release.
export function HoldToTalkControl({
  state,
  turnControl,
  turnMode,
  turnModeError,
}: {
  readonly state: VoiceSessionState;
  readonly turnControl: AdapterTurnControl | undefined;
  readonly turnMode: 'automatic' | 'manual';
  readonly turnModeError: unknown;
}) {
  const isConnected = isVoiceConnected(state);
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
    <>
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
    </>
  );
}
