import { createMaelstrom } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools/production';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import { registerDemoVoice } from '../lib/demo-voice';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { orchestrationLegibility } from '../lib/orchestration-legibility';
import { createAdapter } from '../lib/voice-adapter';
import {
  DEMO_VOICE_PROVIDERS,
  voiceProviderStore,
} from '../lib/voice-provider';
import { blockedSendersEntry } from './vessels/blocked-senders.vessel';
import { inboxEntry } from './vessels/inbox.vessel';
import { messageEntry } from './vessels/message.vessel';
import { notificationsEntry } from './vessels/notifications.vessel';
import { privacyEntry } from './vessels/privacy.vessel';
import { signatureEntry } from './vessels/signature.vessel';
import { storageEntry } from './vessels/storage.vessel';
import { textSizeEntry } from './vessels/text-size.vessel';
import { themeEntry } from './vessels/theme.vessel';
import { vacationReplyEntry } from './vessels/vacation-reply.vessel';

export const mailVessels = [
  inboxEntry,
  messageEntry,
  textSizeEntry,
  notificationsEntry,
  themeEntry,
  privacyEntry,
  blockedSendersEntry,
  signatureEntry,
  vacationReplyEntry,
  storageEntry,
] as const;

export const mailM = createMaelstrom({ vessels: mailVessels })
  .with(
    maelstromRealtime({
      providers: DEMO_VOICE_PROVIDERS,
      initialProvider: () => voiceProviderStore.state.provider,
      createAdapter: ({ provider, sessionId }) =>
        createAdapter(provider, sessionId),
      onSession: registerDemoVoice,
    }),
  )
  .with(orchestrationLegibility)
  .with(devtools({ capture: diagnosticCapture }));
