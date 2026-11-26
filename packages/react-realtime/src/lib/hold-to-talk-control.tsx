import type { VoiceSessionState } from '@maelstrom-co/client';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { UseVoiceResult } from './maelstrom-realtime.js';

/** Props for the `HoldToTalkControl` component added by {@link maelstromRealtime}. */
export interface HoldToTalkControlProps {
  /** Additional class name for the hold-to-talk button. */
  readonly className?: string;
  /** Additional class name for the automatic-mode degradation guidance text. */
  readonly guidanceClassName?: string;
  /** Button label while idle; defaults to `'Hold to talk'`. */
  readonly label?: string;
  /** Button label while pressed; defaults to `label`. */
  readonly activeLabel?: string;
  /** Guidance shown when automatic mode degrades to manual with an error. */
  readonly fallbackGuidance?: string;
}

const CONNECTED_STATES: ReadonlySet<VoiceSessionState> = new Set([
  'connected',
  'listening',
  'thinking',
  'speaking',
]);

const DEFAULT_LABEL = 'Hold to talk';
const DEFAULT_FALLBACK_GUIDANCE =
  'Automatic voice detection unavailable; hold to talk.';

/**
 * Builds the `HoldToTalkControl` component bound to a specific `useVoice` hook.
 * Created inside the `maelstromRealtime()` factory closure (it needs the same
 * `useVoice` instance the extension attaches to the Maelstrom instance) rather
 * than exported as a standalone component.
 */
export function createHoldToTalkControl(
  useVoice: () => Pick<
    UseVoiceResult<unknown>,
    'state' | 'turnControl' | 'turnMode' | 'turnModeError'
  >,
) {
  return function HoldToTalkControl({
    className,
    guidanceClassName,
    label = DEFAULT_LABEL,
    activeLabel,
    fallbackGuidance = DEFAULT_FALLBACK_GUIDANCE,
  }: HoldToTalkControlProps = {}): ReactElement | null {
    const { state, turnControl, turnMode, turnModeError } = useVoice();
    const isConnected = CONNECTED_STATES.has(state);
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

    const showGuidance =
      turnMode === 'manual' &&
      turnControl !== undefined &&
      turnModeError !== undefined;
    const showManualControl =
      turnControl !== undefined && (turnMode === 'manual' || pressActive);

    if (!showGuidance && !showManualControl) return null;

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
        {showGuidance && (
          <span className={guidanceClassName}>{fallbackGuidance}</span>
        )}
        {showManualControl && (
          <button
            type="button"
            disabled={!isConnected}
            aria-pressed={pressActive}
            data-active={pressActive ? 'true' : 'false'}
            onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              startPress();
            }}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onPointerCancel={endPress}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            className={className}
          >
            {pressActive && activeLabel !== undefined ? activeLabel : label}
          </button>
        )}
      </>
    );
  };
}
