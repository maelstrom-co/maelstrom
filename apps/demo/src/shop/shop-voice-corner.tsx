import type { VoiceSessionState } from '@maelstrom-co/client';
import type { MouseEvent } from 'react';
import { EnablePlaybackButton } from '../components/enable-playback-button';
import { HoldToTalkControl } from '../components/hold-to-talk-control';
import { prepareBrowserOpenAIVoice } from '../lib/voice-adapter';
import { isVoiceConnected } from '../lib/voice-session-state';
import { shopM } from './maelstrom';
import { ShopCaption } from './shop-caption';

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

export function ShopVoiceCorner({
  needsKey,
  onRequireKey,
}: {
  readonly needsKey: boolean;
  readonly onRequireKey: () => void;
}) {
  const {
    state,
    provider,
    session,
    switching,
    turnControl,
    turnMode,
    turnModeError,
  } = shopM.useVoice();

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

  const showHoldToTalk = turnMode === 'manual' && turnControl !== undefined;
  const showEnablePlayback = provider === 'live' && isVoiceConnected(state);

  return (
    <div className="shop-voice-corner">
      {(showHoldToTalk || showEnablePlayback) && (
        <div className="shop-voice-actions">
          <HoldToTalkControl
            state={state}
            turnControl={turnControl}
            turnMode={turnMode}
            turnModeError={turnModeError}
          />
          {showEnablePlayback && (
            <EnablePlaybackButton
              provider={provider}
              state={state}
              session={session}
              switching={switching}
            />
          )}
        </div>
      )}
      <ShopCaption />
      <div className="shop-voice-status">
        <span
          className="shop-voice-pill status-pill"
          data-state={state}
          role="status"
          aria-label="Voice status"
        >
          {voicePillLabel(state)}
        </span>
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
