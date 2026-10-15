import type { VoiceSessionState } from '@maelstrom-co/client';
import { RealtimeVoiceError } from '@maelstrom-co/realtime';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useDemoMaelstrom } from '../lib/demo-maelstrom-context';
import { demoVoiceSession } from '../lib/demo-voice';
import { liveErrorMessage } from '../lib/live-exchange';
import { getVoiceErrorStatusLabel } from './voice-error-copy';

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
 * is never rendered or serialized. A configured greeting shows preparation
 * status until it settles, while idle, error, and active-turn labels keep
 * precedence over the preparation label.
 */
export function VoiceControl({ showOrb = true }: VoiceControlProps = {}) {
  const maelstrom = useDemoMaelstrom();
  const {
    greetingState,
    state,
    error,
    turnControl,
    turnMode,
    turnModeError,
    skipGreeting,
    session,
    provider,
    connect,
    disconnect,
    switching,
  } = maelstrom.useVoice();
  const { snapshot } = maelstrom.useVoiceObservations();
  const isConnected = CONNECTED_STATES.has(state);
  const isPreparing =
    greetingState === 'preparing' && state !== 'idle' && state !== 'error';
  let statusLabel = STATE_LABEL[state];
  if (state === 'error') {
    statusLabel = getVoiceErrorStatusLabel(error);
  } else if (
    isPreparing &&
    state !== 'connecting' &&
    !ACTIVE_STATES.has(state)
  ) {
    statusLabel = 'Preparing greeting…';
  } else if (
    (greetingState === 'settled' || greetingState === 'skipped') &&
    state === 'connected'
  ) {
    statusLabel = 'Listening';
  }
  if (provider === 'live')
    statusLabel = `${snapshot.connection} · Mic ${snapshot.media.microphone}`;
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
      {showOrb && <maelstrom.VoiceOrb size={20} />}
      <div
        aria-live="polite"
        className={`flex min-w-0 items-center gap-2 text-xs font-medium ${
          state === 'error' ? 'text-red-400' : 'text-ink-2'
        }`}
        role="status"
      >
        <span className="min-w-0 truncate">{statusLabel}</span>
      </div>
      <span className="text-xs text-ink-3">
        UI:{' '}
        {snapshot.applicationWork.planning === 'active'
          ? 'planning'
          : snapshot.applicationWork.applying === 'active'
            ? 'applying'
            : snapshot.applicationWork.applying === 'unknown'
              ? 'outcome unknown'
              : 'idle'}
      </span>
      {provider === 'live' && (
        <>
          <button
            type="button"
            className="status-pill min-h-11 rounded-full px-3 text-xs"
            disabled={switching}
            onClick={() => {
              void (
                state === 'idle' || state === 'error' ? connect() : disconnect()
              ).catch(() => {});
            }}
          >
            {state === 'idle' || state === 'error'
              ? snapshot.generation === 0
                ? 'Start voice'
                : 'Reconnect'
              : 'End voice'}
          </button>
          <button
            type="button"
            className="status-pill min-h-11 rounded-full px-3 text-xs"
            disabled={!isConnected || switching}
            onClick={() => {
              const adapter = demoVoiceSession(session)?.adapter;
              if (adapter instanceof OpenAILiveAdapter)
                void adapter.activateAudio().catch(() => {});
            }}
          >
            Enable playback
          </button>
          {state === 'error' && (
            <span
              role="alert"
              className="absolute bottom-full left-3 right-3 mx-auto max-w-md rounded-md border border-pink/30 bg-bg-1 px-3 py-2 text-xs text-pink"
            >
              {liveErrorMessage(
                error instanceof RealtimeVoiceError ? error.cause : error,
              )}
            </span>
          )}
        </>
      )}
      {isPreparing && (
        <button
          type="button"
          onClick={skipGreeting}
          className="status-pill min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 py-2 font-mono text-xs uppercase tracking-[.1em] text-ink-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Skip greeting
        </button>
      )}
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
