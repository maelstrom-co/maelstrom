import type { UseVoiceResult } from '@maelstrom-co/react-realtime';

type MuteToggleVoice = Pick<
  UseVoiceResult,
  'state' | 'inputMuted' | 'setInputMuted'
>;

/**
 * Builds a stand-in for the SDK `VoiceMuteToggle` that reads the voice result a
 * test mocked `useVoice` with, so host tests can mock the module boundary.
 */
export function createVoiceMuteToggleStub(getVoice: () => MuteToggleVoice) {
  return function VoiceMuteToggle(props: { className?: string }) {
    const voice = getVoice();
    if (voice.state === 'idle' || voice.state === 'error') return null;
    return (
      <button
        type="button"
        data-testid="voice-mute-toggle"
        aria-label={voice.inputMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={voice.inputMuted}
        className={props.className}
        onClick={() => voice.setInputMuted(!voice.inputMuted)}
      />
    );
  };
}
