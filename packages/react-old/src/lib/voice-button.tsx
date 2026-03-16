/**
 * VoiceButton component - Button with voice state indicator
 *
 * A complete voice control button that shows:
 * - Voice state (idle/listening/speaking)
 * - Current transcript
 * - Audio level visualization
 */

import { VoiceOrb } from './voice-orb.js';

export interface VoiceButtonProps {
  /** Current voice state */
  state: 'idle' | 'listening' | 'speaking';
  /** Audio level (0-1) for visualization */
  audioLevel?: number;
  /** Current transcript text to display */
  transcript?: string;
  /** Called when button is clicked */
  onClick?: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show transcript text */
  showTranscript?: boolean;
}

const sizeConfig = {
  sm: { orb: 40, fontSize: 14, padding: 8 },
  md: { orb: 64, fontSize: 16, padding: 12 },
  lg: { orb: 80, fontSize: 18, padding: 16 },
};

const stateLabels = {
  idle: 'Tap to speak',
  listening: 'Listening...',
  speaking: 'Speaking...',
};

/**
 * VoiceButton - Voice control with visual feedback
 *
 * @example
 * ```tsx
 * <VoiceButton
 *   state={isListening ? 'listening' : isSpeaking ? 'speaking' : 'idle'}
 *   audioLevel={audioLevel}
 *   transcript={transcript}
 *   onClick={toggleListening}
 * />
 * ```
 */
export function VoiceButton({
  state,
  audioLevel = 0,
  transcript,
  onClick,
  disabled = false,
  size = 'md',
  showTranscript = true,
}: VoiceButtonProps) {
  const config = sizeConfig[size];
  const label = stateLabels[state];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: config.padding,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <VoiceOrb
        state={state}
        audioLevel={audioLevel}
        size={config.orb}
        {...(onClick && { onClick })}
        disabled={disabled}
      />

      <div
        style={{
          textAlign: 'center',
          fontSize: config.fontSize,
          color: state === 'idle' ? '#6b7280' : '#374151',
          fontWeight: state === 'idle' ? 400 : 500,
          minHeight: config.fontSize * 1.5,
        }}
      >
        {showTranscript && transcript ? transcript : label}
      </div>

      {showTranscript && transcript && (
        <div
          style={{
            fontSize: config.fontSize * 0.875,
            color: '#9ca3af',
            fontStyle: 'italic',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
