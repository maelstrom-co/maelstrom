import type { VoiceSessionState } from '@maelstrom-co/client';
import type { MouseEvent } from 'react';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { mailM } from './maelstrom';
import { MailCaption } from './mail-caption';

/**
 * Short status words shown in the pill beside the voice orb. A request in
 * flight reads as "Working on it" unless the voice state has something more
 * pressing to say.
 */
export function voicePillLabel(
  state: VoiceSessionState,
  requestInFlight = false,
): string {
  if (requestInFlight && showsWorking(state)) return 'Working on it';
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
  const requestInFlight = mailM.useMaelstrom(
    (maelstrom) => maelstrom.isProcessing,
  );
  const working = requestInFlight && showsWorking(state);

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
        <span
          className="mail-voice-pill"
          data-state={state}
          data-working={working || undefined}
          role="status"
        >
          {voicePillLabel(state, requestInFlight)}
          {working ? (
            <span className="mail-working-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : null}
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

function showsWorking(state: VoiceSessionState): boolean {
  return state !== 'connecting' && state !== 'speaking' && state !== 'error';
}
