import type { VoiceSessionState } from '@maelstrom-co/client';
import type { MouseEvent } from 'react';

import { EnablePlaybackButton } from '../components/enable-playback-button';
import { TurnModeToggle } from '../components/turn-mode-toggle';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { isVoiceConnected } from '../lib/voice-session-state';
import { tasklaneM } from './maelstrom';
import { TasklaneCaption } from './tasklane-caption';

export function TasklaneVoiceCorner({
  needsKey,
  onRequireKey,
}: {
  readonly needsKey: boolean;
  readonly onRequireKey: () => void;
}) {
  const {
    state,
    switching,
    turnMode,
    turnControl,
    provider,
    playbackBlocked,
    resumePlayback,
  } = tasklaneM.useVoice();
  const holdToTalk = turnMode === 'manual' && turnControl !== undefined;

  // The orb owns its click handler, so the capture phase runs first: it
  // blocks the click when no key is on hand, and otherwise unlocks browser
  // audio inside the same user gesture before the orb connects.
  const handleOrbClickCapture = (event: MouseEvent) => {
    if (needsKey) {
      event.preventDefault();
      event.stopPropagation();
      onRequireKey();
      return;
    }
    if (state === 'idle' || state === 'error') prepareBrowserOpenAIVoice();
  };

  // Blocked playback takes the pill's slot so the dock never grows.
  const showEnablePlayback =
    provider === 'live' && playbackBlocked && isVoiceConnected(state);

  return (
    <div className="tasklane-voice-corner">
      <TasklaneCaption />
      <div className="tasklane-voice-status">
        {showEnablePlayback ? (
          <EnablePlaybackButton
            state={state}
            switching={switching}
            onResume={resumePlayback}
            className="tasklane-voice-pill tasklane-voice-playback status-pill"
          />
        ) : (
          <span
            className="tasklane-voice-pill status-pill"
            data-state={state}
            role="status"
            aria-label="Voice status"
          >
            {voicePillLabel(state, holdToTalk)}
          </span>
        )}
        <tasklaneM.VoiceMuteToggle className="tasklane-voice-pill status-pill" />
        {holdToTalk && (
          <tasklaneM.HoldToTalkControl
            className="tasklane-voice-pill tasklane-voice-control status-pill select-none touch-none"
            guidanceClassName="min-w-0 text-xs text-amber-300"
          />
        )}
        <TurnModeToggle
          turnControl={turnControl}
          turnMode={turnMode}
          switching={switching}
          className="tasklane-voice-pill tasklane-voice-control status-pill"
        />
        <span
          className="tasklane-voice-disclosure"
          data-testid="ai-voice-disclosure"
        >
          AI-generated voice
        </span>
      </div>
      <div
        className="tasklane-voice-orb-wrap"
        onClickCapture={handleOrbClickCapture}
      >
        <tasklaneM.VoiceOrb size={44} className="voice-orb" />
      </div>
    </div>
  );
}

function voicePillLabel(state: VoiceSessionState, holdToTalk = false): string {
  switch (state) {
    case 'idle':
      return 'Tap to talk';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return holdToTalk ? 'Ready' : 'Listening';
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
