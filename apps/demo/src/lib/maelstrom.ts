import { createMaelstrom } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools/production';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { mapEntry } from '../vessels/map.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { aguiExperiment } from './agui-extension';
import { DEMO_GREETING, DEMO_OPENAI_VOICE } from './demo-greeting-tts';
import { createDemoTelemetry } from './demo-telemetry';
import { demoVoiceOpening, registerDemoVoice } from './demo-voice';
import { diagnosticCapture } from './diagnostic-capture';
import { orchestrationLegibility } from './orchestration-legibility';
import { createAdapter, prepareBrowserOpenAIVoice } from './voice-adapter';
import { DEMO_VOICE_PROVIDERS, voiceProviderStore } from './voice-provider';

export { DEMO_GREETING, DEMO_OPENAI_VOICE, prepareBrowserOpenAIVoice };

const vessels = [
  calendarEntry,
  weatherEntry,
  journalEntry,
  tasksEntry,
  mapEntry,
] as const;

const demoTelemetry = createDemoTelemetry();
if (import.meta.hot) import.meta.hot.dispose(() => demoTelemetry.dispose());

export const m = createMaelstrom({
  vessels,
})
  .with(
    maelstromRealtime({
      providers: DEMO_VOICE_PROVIDERS,
      initialProvider: () => voiceProviderStore.state.provider,
      createAdapter: ({ provider, sessionId }) =>
        createAdapter(provider, sessionId),
      opening: demoVoiceOpening(DEMO_GREETING),
      onSession: registerDemoVoice,
    }),
  )
  .with(orchestrationLegibility)
  .with(aguiExperiment)
  .with(demoTelemetry.extension)
  .with(
    devtools({
      capture: diagnosticCapture,
      telemetry: demoTelemetry.telemetry,
    }),
  );
