import { createMaelstrom } from '@maelstrom-co/react';
import { devtools } from '@maelstrom-co/react-devtools/production';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';
import { createDemoTelemetry } from '../lib/demo-telemetry';
import { registerDemoVoice } from '../lib/demo-voice';
import { diagnosticCapture } from '../lib/diagnostic-capture';
import { createAdapter } from '../lib/voice-adapter';
import {
  DEMO_VOICE_PROVIDERS,
  voiceProviderStore,
} from '../lib/voice-provider';
import { cartEntry } from './vessels/cart.vessel';
import { catalogEntry } from './vessels/catalog.vessel';
import { checkoutEntry } from './vessels/checkout.vessel';
import { ordersEntry } from './vessels/orders.vessel';

const shopTelemetry = createDemoTelemetry();
if (import.meta.hot) import.meta.hot.dispose(() => shopTelemetry.dispose());

// A separate instance rather than a filter on the home `m`: the Provider sends
// its factory's whole vessel list as the Engine catalog on every chart
// request, so this keeps day-planner vessels out of the shop prompt.
// No `opening`: the greeting TTS route only speaks the home greeting.
export const shopM = createMaelstrom({
  vessels: [ordersEntry, catalogEntry, cartEntry, checkoutEntry] as const,
})
  .with(
    maelstromRealtime({
      providers: DEMO_VOICE_PROVIDERS,
      initialProvider: () => voiceProviderStore.state.provider,
      createAdapter: ({ provider, sessionId }) =>
        createAdapter(provider, sessionId),
      onSession: registerDemoVoice,
    }),
  )
  .with(shopTelemetry.extension)
  .with(
    devtools({
      capture: diagnosticCapture,
      telemetry: shopTelemetry.telemetry,
    }),
  );
