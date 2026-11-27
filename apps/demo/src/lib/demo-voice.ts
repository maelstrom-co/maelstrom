import type {
  RealtimeOpening,
  RealtimeSessionInit,
} from '@maelstrom-co/react-realtime';

import type { DemoVoiceProvider } from './voice-provider';

export const LIVE_OPENING_INSTRUCTIONS =
  "Greet in English, briefly introducing yourself as Dayline, a daily planner powered by Maelstrom, and ask what the user would like to get done today. After that, follow the user's language.";

/** Live generates its own introduction; the other providers speak the fixed greeting. */
export function demoVoiceOpening(
  greeting: string,
): (context: RealtimeSessionInit<DemoVoiceProvider>) => RealtimeOpening {
  return ({ provider }) =>
    provider === 'live'
      ? { generatedOpening: { instructions: LIVE_OPENING_INSTRUCTIONS } }
      : { greeting: { text: greeting } };
}
