import type {
  RealtimeOpening,
  RealtimeSessionContext,
  RealtimeSessionInit,
} from '@maelstrom-co/react-realtime';
import type {
  RealtimeProviderAdapter,
  RealtimeSession,
} from '@maelstrom-co/realtime';
import type { DemoVoiceProvider } from './voice-provider';

export const LIVE_OPENING_INSTRUCTIONS =
  'In English, briefly introduce yourself as Maelstrom and offer to arrange this workspace.';

export interface DemoVoiceSession {
  readonly provider: DemoVoiceProvider;
  readonly providerInstanceId: string;
  readonly adapter: RealtimeProviderAdapter;
}

/** Live generates its own introduction; the other providers speak the fixed greeting. */
export function demoVoiceOpening(
  greeting: string,
): (context: RealtimeSessionInit<DemoVoiceProvider>) => RealtimeOpening {
  return ({ provider }) =>
    provider === 'live'
      ? { generatedOpening: { instructions: LIVE_OPENING_INSTRUCTIONS } }
      : { greeting: { text: greeting } };
}

/** Demo wiring of a session built by the library, or undefined for a foreign one. */
export function demoVoiceSession(
  session: RealtimeSession,
): DemoVoiceSession | undefined {
  return sessions.get(session);
}

const sessions = new WeakMap<RealtimeSession, DemoVoiceSession>();
/** Keeps app-owned playback recovery attached to the library-owned session. */
export function registerDemoVoice(
  session: RealtimeSession,
  context: RealtimeSessionContext<DemoVoiceProvider>,
): () => void {
  sessions.set(session, {
    provider: context.provider,
    providerInstanceId: context.instanceId,
    adapter: context.adapter,
  });
  return () => {
    sessions.delete(session);
  };
}
