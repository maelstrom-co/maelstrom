import type { VoiceSessionState } from '@maelstrom-co/client';
import type { MouseEvent, ReactNode } from 'react';

import { EnablePlaybackButton } from '../components/enable-playback-button';
import { TurnModeToggle } from '../components/turn-mode-toggle';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { isVoiceConnected } from '../lib/voice-session-state';
import { shopM } from './maelstrom';
import { ShopCaption } from './shop-caption';

export function voicePillLabel(
  state: VoiceSessionState,
  holdToTalk = false,
): string {
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

export function ShopVoiceCorner({
  needsKey,
  onRequireKey,
  reply,
}: {
  readonly needsKey: boolean;
  readonly onRequireKey: () => void;
  readonly reply?: ReactNode;
}) {
  const {
    state,
    switching,
    turnMode,
    turnControl,
    playbackBlocked,
    resumePlayback,
  } = shopM.useVoice();
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
  const showEnablePlayback = playbackBlocked && isVoiceConnected(state);

  return (
    <div className="shop-voice-corner">
      <div className="shop-voice-text">
        <ShopCaption />
        {reply}
      </div>
      <div className="shop-voice-status">
        {showEnablePlayback ? (
          <EnablePlaybackButton
            state={state}
            switching={switching}
            onResume={resumePlayback}
            className="shop-voice-pill shop-voice-playback status-pill"
          />
        ) : (
          <span
            className="shop-voice-pill status-pill"
            data-state={state}
            role="status"
            aria-label="Voice status"
          >
            {voicePillLabel(state, holdToTalk)}
          </span>
        )}
        <shopM.VoiceMuteToggle className="shop-voice-pill status-pill" />
        {holdToTalk && (
          <shopM.HoldToTalkControl
            className="shop-voice-pill shop-voice-control status-pill select-none touch-none"
            guidanceClassName="min-w-0 text-xs text-amber-300"
          />
        )}
        <TurnModeToggle
          turnControl={turnControl}
          turnMode={turnMode}
          switching={switching}
          className="shop-voice-pill shop-voice-control status-pill"
        />
        <span
          className="shop-voice-disclosure"
          data-testid="ai-voice-disclosure"
        >
          AI-generated voice
        </span>
      </div>
      <div
        className="shop-voice-orb-wrap"
        onClickCapture={handleOrbClickCapture}
      >
        <shopM.VoiceOrb size={44} className="voice-orb" />
      </div>
    </div>
  );
}
