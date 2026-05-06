import { useEffect, useRef } from 'react';
import type { VoiceSessionState } from '@maelstrom-co/react-voice';

// Layered above the chart's debug overlay (zIndex: 9999) so the gesture
// affordance is reachable even with debug mode on.
const Z_INDEX_DIALOG_ABOVE_DEBUG = 10_000;

interface EnableVoiceDialogProps {
  onEnable: () => void;
  /**
   * Voice state from the host hook. When `'error'` the dialog surfaces a
   * brief retry message so a stuck `needsUserGesture` (e.g. permanent mic
   * denial) gives the user something to look at instead of silently
   * accepting clicks behind the modal.
   */
  voiceState: VoiceSessionState;
}

export function EnableVoiceDialog({
  onEnable,
  voiceState,
}: EnableVoiceDialogProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  const showError = voiceState === 'error';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enable-voice-title"
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-4"
      style={{ zIndex: Z_INDEX_DIALOG_ABOVE_DEBUG }}
    >
      <div className="max-w-sm w-full rounded-lg bg-gray-800 border border-gray-700 p-6 shadow-xl">
        <h2
          id="enable-voice-title"
          className="text-lg font-semibold text-white mb-2"
        >
          Enable voice
        </h2>
        <p className="text-sm text-gray-300 mb-4">
          Your browser requires a click before the demo can use the microphone
          and play assistant audio. Tap below to enable voice.
        </p>
        {showError && (
          <p role="alert" className="text-sm text-red-400 mb-4">
            Voice didn&apos;t start. Check microphone permission and try again.
          </p>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={onEnable}
          className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md font-medium text-white transition-colors"
        >
          {showError ? 'Retry' : 'Enable voice'}
        </button>
      </div>
    </div>
  );
}
