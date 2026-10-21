import type { VoiceSessionState } from '@maelstrom-co/client';
import type { MouseEvent } from 'react';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { mailM } from './maelstrom';
import { MailCaption } from './mail-caption';

/** Short status words shown in the pill beside the voice orb. */
export function voicePillLabel(state: VoiceSessionState): string {
  switch (state) {
    case 'idle':
      return 'Tap to talk';
    case 'connecting':
      return 'Connecting';
    case 'connected':
    case 'listening':
      return 'Listening';
    case 'thinking':
      return 'Thinking';
    case 'speaking':
      return 'Speaking';
    case 'error':
      return 'Voice error';
  }
}

export function MailVoiceCorner({
  needsKey,
  onRequireKey,
}: {
  readonly needsKey: boolean;
  readonly onRequireKey: () => void;
}) {
  const { state } = mailM.useVoice();

  const handleOrbClickCapture = (event: MouseEvent) => {
    if (needsKey) {
      event.preventDefault();
      event.stopPropagation();
      onRequireKey();
      return;
    }
    if (state === 'idle' || state === 'error') prepareBrowserOpenAIVoice();
  };

  return (
    <div className="mail-voice-corner">
      <MailCaption />
      <div className="mail-voice-status">
        <span className="mail-voice-pill" data-state={state} role="status">
          {voicePillLabel(state)}
        </span>
        <span
          className="mail-voice-disclosure"
          data-testid="ai-voice-disclosure"
        >
          AI-generated voice
        </span>
      </div>
      <div
        className="mail-voice-orb-wrap"
        onClickCapture={handleOrbClickCapture}
      >
        <mailM.VoiceOrb size={56} className="mail-voice-orb" />
      </div>
    </div>
  );
}
