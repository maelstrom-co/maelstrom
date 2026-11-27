import { createMaelstrom } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools/production';
import {
  maelstromRealtime,
  type RealtimeOpening,
  type RealtimeSessionInit,
} from '@maelstrom-co/react-realtime';

import { TASKLANE_GREETING } from '../lib/demo-greeting-tts';
import { createDemoTelemetry } from '../lib/demo-telemetry';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { createAdapter } from '../lib/voice-adapter';
import { voiceProviderStore } from '../lib/voice-provider';
import { TASKLANE_CELL_SIZE_PX } from './default-layout';
import { tasklaneInstanceLifetime } from './instance-lifetime';
import { tasklaneRequestReferences } from './request-references';
import { tasklaneSettleSignal } from './settle-signal';
import { flexibleTableEntry } from './vessels/flexible-table.vessel';
import { myPrioritiesEntry } from './vessels/my-priorities.vessel';
import { projectPulseEntry } from './vessels/project-pulse.vessel';
import { projectTasksEntry } from './vessels/project-tasks.vessel';
import { sourceFeedbackEntry } from './vessels/source-feedback.vessel';
import { taskDetailEntry } from './vessels/task-detail.vessel';
import { teamLoadEntry } from './vessels/team-load.vessel';
import { triageInboxEntry } from './vessels/triage-inbox.vessel';
import {
  TASKLANE_VOICE_PROVIDERS,
  type TasklaneVoiceProvider,
  tasklaneVoiceProvider,
} from './voice-providers';

export const TASKLANE_OPENING_INSTRUCTIONS =
  "Greet in English, briefly introducing yourself as Tasklane, powered by Maelstrom, and offer to turn the feedback into tasks. Mention that the user can also change the screen, for example by asking to show team load. After that, follow the user's language.";

const tasklaneTelemetry = createDemoTelemetry();
if (import.meta.hot) import.meta.hot.dispose(() => tasklaneTelemetry.dispose());

/**
 * Live generates its own Tasklane introduction. Other providers speak the
 * fixed Tasklane greeting through the allowlisted greeting TTS route.
 */
export function tasklaneVoiceOpening({
  provider,
}: RealtimeSessionInit<TasklaneVoiceProvider>): RealtimeOpening {
  return provider === 'live'
    ? { generatedOpening: { instructions: TASKLANE_OPENING_INSTRUCTIONS } }
    : { greeting: { text: TASKLANE_GREETING } };
}

// A separate instance rather than a filter on the home `m`: the Provider sends
// its factory's whole Vessel list as the Engine catalog on every chart
// request, so this keeps other pages' Vessels out of the Tasklane prompt.
export const tasklaneM = createMaelstrom({
  vessels: [
    sourceFeedbackEntry,
    projectTasksEntry,
    myPrioritiesEntry,
    taskDetailEntry,
    teamLoadEntry,
    triageInboxEntry,
    projectPulseEntry,
    flexibleTableEntry,
  ] as const,
  cellSizePx: TASKLANE_CELL_SIZE_PX,
})
  .with(
    maelstromRealtime({
      providers: TASKLANE_VOICE_PROVIDERS,
      initialProvider: () =>
        tasklaneVoiceProvider(voiceProviderStore.state.provider),
      createAdapter: ({ provider, sessionId }) =>
        createAdapter(provider, sessionId),
      opening: tasklaneVoiceOpening,
    }),
  )
  .with(tasklaneRequestReferences)
  .with(tasklaneSettleSignal)
  .with(tasklaneInstanceLifetime)
  .with(tasklaneTelemetry.extension)
  .with(
    devtools({
      capture: diagnosticCapture,
      telemetry: tasklaneTelemetry.telemetry,
    }),
  );
