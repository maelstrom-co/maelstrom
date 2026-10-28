import type { VoiceSessionState } from '@maelstrom-co/client';
import type { MouseEvent } from 'react';
import { EnablePlaybackButton } from '../components/enable-playback-button';
import { useLivePlaybackBlocked } from '../lib/use-live-playback-blocked';
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
  const { state, provider, session, switching } = shopM.useVoice();
  const playbackBlocked = useLivePlaybackBlocked(session);

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
    <div className="shop-voice-corner">
      <ShopCaption />
      <div className="shop-voice-status">
        {showEnablePlayback ? (
          <EnablePlaybackButton
            provider={provider}
            state={state}
            session={session}
            switching={switching}
            className="shop-voice-pill shop-voice-playback status-pill"
          />
        ) : (
          <span
            className="shop-voice-pill status-pill"
            data-state={state}
            role="status"
            aria-label="Voice status"
          >
            {voicePillLabel(state)}
          </span>
        )}
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
