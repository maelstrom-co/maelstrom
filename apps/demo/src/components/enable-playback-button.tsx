import type { VoiceSessionState } from '@maelstrom-co/client';
import type { RealtimeSession } from '@maelstrom-co/realtime';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { demoVoiceSession } from '../lib/demo-voice';
import { isVoiceConnected } from '../lib/voice-session-state';

// A GPT-Live session started outside a click gesture, such as the auto-start
// after saving a key, can have its playback blocked by the browser. This click
// gives the adapter the gesture it needs to resume audio.
export function EnablePlaybackButton({
  provider,
  state,
  session,
  switching,
}: {
  readonly provider: string | undefined;
  readonly state: VoiceSessionState;
  readonly session: RealtimeSession;
  readonly switching: boolean;
}) {
  if (provider !== 'live') return null;
  return (
    <button
      type="button"
      className="status-pill min-h-11 rounded-full px-3 text-xs"
      disabled={!isVoiceConnected(state) || switching}
      onClick={() => {
        const adapter = demoVoiceSession(session)?.adapter;
        if (adapter instanceof OpenAILiveAdapter)
          void adapter.activateAudio().catch(() => {});
      }}
    >
      Enable playback
    </button>
  );
}
