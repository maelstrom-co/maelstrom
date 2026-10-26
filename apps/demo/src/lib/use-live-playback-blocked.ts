import type { RealtimeSession } from '@maelstrom-co/realtime';
import { OpenAILiveAdapter } from '@maelstrom-co/realtime-openai-live';
import { useCallback, useSyncExternalStore } from 'react';
import { demoVoiceSession } from './demo-voice';

/** Whether the browser blocked GPT-Live output for this session, so a click is needed to resume it. */
export function useLivePlaybackBlocked(session: RealtimeSession): boolean {
  const adapter = liveAdapter(session);
  const subscribe = useCallback(
    (onChange: () => void) =>
      adapter?.generatedOpening.readiness.subscribe(onChange) ?? noop,
    [adapter],
  );
  const getSnapshot = () =>
    adapter?.getTransportSnapshot().playback === 'blocked';
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function liveAdapter(session: RealtimeSession): OpenAILiveAdapter | undefined {
  const adapter = demoVoiceSession(session)?.adapter;
  return adapter instanceof OpenAILiveAdapter ? adapter : undefined;
}

function noop() {}
