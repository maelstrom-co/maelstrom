import type { CSSProperties, ReactElement } from 'react';

import type { UseVoiceResult } from './maelstrom-realtime.js';

/** Props for the `VoiceMuteToggle` component added by {@link maelstromRealtime}. */
export interface VoiceMuteToggleProps {
  /** Additional class name for consumer restyling; combine with `data-muted` for muted rules. */
  readonly className?: string;
}

const DEFAULT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
};

/**
 * Builds the `VoiceMuteToggle` component bound to a specific `useVoice` hook.
 * Renders only while the shared voice session is live (`connecting`,
 * `connected`, `listening`, `thinking`, or `speaking`) and toggles microphone
 * input mute without disconnecting or cancelling in-flight intent work.
 */
export function createVoiceMuteToggle(
  useVoice: () => Pick<
    UseVoiceResult<unknown>,
    'state' | 'inputMuted' | 'setInputMuted' | 'switching'
  >,
) {
  return function VoiceMuteToggle({
    className,
  }: VoiceMuteToggleProps): ReactElement | null {
    const { state, inputMuted, setInputMuted, switching } = useVoice();
    const live = state !== 'idle' && state !== 'error';
    if (!live) return null;

    return (
      <button
        type="button"
        aria-pressed={inputMuted}
        aria-label={inputMuted ? 'Unmute microphone' : 'Mute microphone'}
        data-muted={inputMuted ? 'true' : 'false'}
        className={className}
        style={className ? undefined : DEFAULT_STYLE}
        disabled={switching}
        onClick={() => {
          setInputMuted(!inputMuted);
        }}
      >
        <MicrophoneIcon muted={inputMuted} />
        <span>{inputMuted ? 'Muted' : 'Mute'}</span>
      </button>
    );
  };
}

function MicrophoneIcon({ muted }: { readonly muted: boolean }): ReactElement {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
      {muted && <line x1="2" x2="22" y1="2" y2="22" />}
    </svg>
  );
}
