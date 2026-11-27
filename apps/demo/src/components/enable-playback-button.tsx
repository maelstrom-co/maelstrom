import type { VoiceSessionState } from '@maelstrom-co/client';

import { isVoiceConnected } from '../lib/voice-session-state';

// A voice session started outside a click gesture, such as the auto-start
// after saving a key, can have its playback blocked by the browser. This click
// gives the session the gesture it needs to resume audio.
export function EnablePlaybackButton({
  state,
  switching,
  onResume,
  className = 'status-pill min-h-11 rounded-full px-3 text-xs',
}: {
  readonly state: VoiceSessionState;
  readonly switching: boolean;
  readonly onResume: () => Promise<void>;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={!isVoiceConnected(state) || switching}
      onClick={() => {
        void onResume().catch(() => {});
      }}
    >
      Enable playback
    </button>
  );
}
