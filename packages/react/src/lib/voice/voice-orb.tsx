import { useInsertionEffect } from 'react';

import type { UseVoiceOptions, UseVoiceReturn, VoiceSessionState } from './use-voice-types.js';

export interface VoiceOrbProps {
  /** Size of the orb in pixels (default: 64) */
  size?: number;
  /** Whether the orb is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
}

/**
 * Factory that creates a self-contained VoiceOrb component.
 * The orb internally calls useVoice() as an observer (no options) to read
 * shared session state, and toggles listening on click.
 */
export function createVoiceOrb(
  useVoice: (options?: UseVoiceOptions) => UseVoiceReturn,
) {
  let stylesInjected = false;

  return function VoiceOrb({ size = 64, disabled, className }: VoiceOrbProps) {
    const voice = useVoice();

    useInsertionEffect(() => {
      if (stylesInjected || typeof document === 'undefined') return;
      const style = document.createElement('style');
      style.setAttribute('data-maelstrom', 'voice-orb');
      style.textContent = KEYFRAMES_CSS;
      document.head.appendChild(style);
      stylesInjected = true;
    }, []);

    if (!voice.isVoiceSupported) return null;

    const visualState = mapToVisualState(voice.state);
    const isDisabled = disabled || !voice.isReady;

    const handleClick = () => {
      if (isDisabled) return;
      switch (voice.state) {
        case 'idle':
        case 'silence':
          voice.start();
          break;
        case 'listening':
          voice.stop();
          break;
        case 'speaking':
          voice.interrupt();
          break;
      }
    };

    const stateStyles = getStateStyles(visualState);

    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          border: 'none',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.5 : 1,
          transition: 'all 0.15s ease-out',
          ...stateStyles,
        }}
        aria-label={getAriaLabel(visualState)}
      />
    );
  };
}

type VisualState = 'idle' | 'listening' | 'processing' | 'speaking';

function mapToVisualState(state: VoiceSessionState): VisualState {
  if (state === 'silence') return 'processing';
  return state;
}

function getAriaLabel(visualState: VisualState): string {
  switch (visualState) {
    case 'listening':
      return 'Listening... Click to stop';
    case 'processing':
      return 'Processing...';
    case 'speaking':
      return 'Speaking...';
    default:
      return 'Click to start listening';
  }
}

function getStateStyles(visualState: VisualState): Record<string, string> {
  switch (visualState) {
    case 'listening':
      return {
        backgroundColor: '#3b82f6',
        boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)',
        animation: 'maelstrom-voice-pulse 1.5s ease-in-out infinite',
      };
    case 'processing':
      return {
        backgroundColor: '#f59e0b',
        boxShadow: '0 0 25px rgba(245, 158, 11, 0.5)',
        animation: 'maelstrom-voice-spin 1s linear infinite',
      };
    case 'speaking':
      return {
        backgroundColor: '#22c55e',
        boxShadow: '0 0 30px rgba(34, 197, 94, 0.6)',
        animation: 'maelstrom-voice-wave 1s ease-in-out infinite',
      };
    default:
      return {
        backgroundColor: '#9ca3af',
        boxShadow: '0 0 10px rgba(156, 163, 175, 0.3)',
        animation: 'none',
      };
  }
}

const KEYFRAMES_CSS = `
  @keyframes maelstrom-voice-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }
  @keyframes maelstrom-voice-spin {
    0% { box-shadow: 0 0 25px rgba(245, 158, 11, 0.5); }
    50% { box-shadow: 0 0 35px rgba(245, 158, 11, 0.8); }
    100% { box-shadow: 0 0 25px rgba(245, 158, 11, 0.5); }
  }
  @keyframes maelstrom-voice-wave {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.05); }
  }
`;
