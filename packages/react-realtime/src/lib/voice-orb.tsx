import type { VoiceSessionState } from '@maelstrom-co/client';
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from 'react';

import { createLevelMeter } from './level-meter.js';
import type { UseVoiceResult } from './maelstrom-realtime.js';

/** Props for the `VoiceOrb` component added by {@link maelstromRealtime}. */
export interface VoiceOrbProps {
  /** Diameter in px. Default 64. */
  readonly size?: number;
  /** Additional class name for consumer restyling; combine with `data-state` for per-state rules. */
  readonly className?: string;
}

const STATE_COLORS: Record<VoiceSessionState, string> = {
  idle: '#94a3b8',
  connecting: '#facc15',
  connected: '#38bdf8',
  listening: '#22c55e',
  thinking: '#f97316',
  speaking: '#a855f7',
  error: '#ef4444',
};

/**
 * Builds the `VoiceOrb` component bound to a specific `useVoice` hook.
 * Created inside the `maelstromRealtime()` factory closure (it needs the
 * same `useVoice` instance the extension attaches to the Maelstrom
 * instance) rather than exported as a standalone component.
 */
export function createVoiceOrb(useVoice: () => UseVoiceResult) {
  return function VoiceOrb({
    size = 64,
    className,
  }: VoiceOrbProps): ReactElement {
    const { state, session, connect, disconnect } = useVoice();
    const orbRef = useRef<HTMLButtonElement>(null);
    const disconnectPendingRef = useRef(false);
    const [disconnectPending, setDisconnectPending] = useState(false);

    useEffect(() => {
      if (state !== 'listening' && state !== 'speaking') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const streams = session.getAudioStreams();
      const stream = state === 'listening' ? streams.mic : streams.playback;
      if (!stream) return;

      const meter = createLevelMeter(stream);
      let frame = 0;
      const tick = () => {
        const el = orbRef.current;
        if (el) el.style.transform = `scale(${1 + meter.read() * 0.35})`;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      return () => {
        cancelAnimationFrame(frame);
        meter.dispose();
        const el = orbRef.current;
        if (el) el.style.transform = '';
      };
    }, [state, session]);

    const live = state !== 'idle' && state !== 'error';
    const color = STATE_COLORS[state];
    const style: CSSProperties & { '--maelstrom-orb-color'?: string } = {
      width: size,
      height: size,
      borderRadius: '50%',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      backgroundColor: 'var(--maelstrom-orb-color)',
      '--maelstrom-orb-color': color,
    };

    return (
      <button
        ref={orbRef}
        type="button"
        data-state={state}
        aria-label={live ? 'Stop voice' : 'Start voice'}
        className={className}
        style={style}
        disabled={disconnectPending}
        onClick={() => {
          if (!live) {
            void connect().catch(() => {});
            return;
          }
          if (disconnectPendingRef.current) return;
          disconnectPendingRef.current = true;
          setDisconnectPending(true);
          void disconnect()
            .catch(() => {})
            .finally(() => {
              disconnectPendingRef.current = false;
              setDisconnectPending(false);
            });
        }}
      />
    );
  };
}
