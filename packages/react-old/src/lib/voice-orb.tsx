/**
 * VoiceOrb component - Visual indicator for voice state
 *
 * Displays an animated orb that changes color and size based on voice state:
 * - idle: Gray, static
 * - listening: Blue, pulses with audio level
 * - speaking: Green, animated waves
 */

import { useMemo } from 'react';

export interface VoiceOrbProps {
  /** Current voice state */
  state: 'idle' | 'listening' | 'processing' | 'speaking';
  /** Audio level (0-1) for visualization when listening */
  audioLevel?: number;
  /** Size of the orb in pixels (default: 64) */
  size?: number;
  /** Called when orb is clicked */
  onClick?: () => void;
  /** Whether the orb is disabled */
  disabled?: boolean;
}

/**
 * VoiceOrb - Animated voice state indicator
 *
 * @example
 * ```tsx
 * <VoiceOrb
 *   state={isListening ? 'listening' : isSpeaking ? 'speaking' : 'idle'}
 *   audioLevel={audioLevel}
 *   onClick={toggleListening}
 * />
 * ```
 */
export function VoiceOrb({
  state,
  audioLevel = 0,
  size = 64,
  onClick,
  disabled = false,
}: VoiceOrbProps) {
  const styles = useMemo(() => {
    switch (state) {
      case 'listening': {
        const scale = 1 + audioLevel * 0.3;
        return {
          backgroundColor: '#3b82f6',
          transform: `scale(${scale})`,
          boxShadow: `0 0 ${20 + audioLevel * 30}px rgba(59, 130, 246, ${0.5 + audioLevel * 0.5})`,
          animation: 'pulse 1.5s ease-in-out infinite',
        };
      }

      case 'processing':
        return {
          backgroundColor: '#f59e0b',
          transform: 'scale(1)',
          boxShadow: '0 0 25px rgba(245, 158, 11, 0.5)',
          animation: 'spin 1s linear infinite',
        };

      case 'speaking':
        return {
          backgroundColor: '#22c55e',
          transform: 'scale(1)',
          boxShadow: '0 0 30px rgba(34, 197, 94, 0.6)',
          animation: 'wave 1s ease-in-out infinite',
        };

      default:
        return {
          backgroundColor: '#9ca3af',
          transform: 'scale(1)',
          boxShadow: '0 0 10px rgba(156, 163, 175, 0.3)',
          animation: 'none',
        };
    }
  }, [state, audioLevel]);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s ease-out',
        ...styles,
      }}
      aria-label={
        state === 'listening'
          ? 'Listening... Click to stop'
          : state === 'processing'
            ? 'Processing...'
            : state === 'speaking'
              ? 'Speaking...'
              : 'Click to start listening'
      }
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
        @keyframes spin {
          0% { box-shadow: 0 0 25px rgba(245, 158, 11, 0.5); }
          50% { box-shadow: 0 0 35px rgba(245, 158, 11, 0.8); }
          100% { box-shadow: 0 0 25px rgba(245, 158, 11, 0.5); }
        }
        @keyframes wave {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </button>
  );
}
