import { createMaelstrom } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools/production';
import { calendarEntry } from '../vessels/calendar.vessel';
import { journalEntry } from '../vessels/journal.vessel';
import { mapEntry } from '../vessels/map.vessel';
import { tasksEntry } from '../vessels/tasks.vessel';
import { weatherEntry } from '../vessels/weather.vessel';
import { DEMO_GREETING, DEMO_OPENAI_VOICE } from './demo-greeting-tts';
import { demoRealtime, prepareBrowserOpenAIVoice } from './demo-realtime';
import { createDemoTelemetry } from './demo-telemetry';
import { diagnosticCapture } from './diagnostic-capture';
import { orchestrationLegibility } from './orchestration-legibility';

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
  .with(demoRealtime())
  .with(orchestrationLegibility)
  .with(demoTelemetry.extension)
  .with(
    devtools({
      capture: diagnosticCapture,
      telemetry: demoTelemetry.telemetry,
    }),
  );
