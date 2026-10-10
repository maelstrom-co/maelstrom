import type { EngineConnector } from '@maelstrom-co/client';
import {
  ActionName,
  InstanceId,
  ok,
  SessionId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { createMaelstrom, defineVessel, vessel } from '@maelstrom-co/react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { devtools } from './src/index.js';

const instanceId = InstanceId('counter-main');
const definition = defineVessel({
  id: 'counter',
  name: 'Counter',
  description: 'A deterministic counter for development diagnostics.',
  defaultVariant: 'main',
  variants: {
    main: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'increment', description: 'Increment the counter' }],
    },
  },
});
function Counter() {
  const [count, setCount] = useState(0);
  m.useActions('counter', instanceId, {
    increment: () => {
      setCount((value) => value + 1);
      return ok(undefined);
    },
  });
  return (
    <article style={{ padding: 24 }}>
      <h2>Fixture counter</h2>
      <output aria-label="Counter value">{count}</output>
    </article>
  );
}
const m = createMaelstrom({ vessels: [vessel(definition, Counter)] }).with(
  devtools({ initialIsOpen: true, theme: 'dark' }),
);
const connector: EngineConnector = {
  capabilities: { voice: false, streaming: false, stateful: false },
  connect: async () => {},
  disconnect: async () => {},
  subscribe: () => () => {},
  addAssistantMessage: async () => {},
  getHistory: async () => [],
  process: async (message) => ({
    type: 'maelstrom_response',
    requestId: message.id,
    rationale: 'Deterministic fixture',
    userMessage: 'Counter incremented',
    executionPlan: [{ instanceId, action: ActionName('increment') }],
    layout: {
      type: 'tiling',
      tree: [tilingLeafToken(instanceId)],
      instances: [
        {
          instanceId,
          vesselId: VesselId('counter'),
          variant: VariantName('main'),
        },
      ],
    },
  }),
};
function Controls() {
  const state = m.useMaelstrom();
  return (
    <button
      type="button"
      onClick={() => state.processIntent('Increment the fixture counter')}
      disabled={state.connectionStatus !== 'connected'}
    >
      Apply fixture response
    </button>
  );
}
function Preview() {
  const [session, setSession] = useState(1);
  return (
    <main
      style={{
        fontFamily: 'system-ui',
        padding: 24,
        background: '#eef2f6',
        minHeight: '100vh',
      }}
    >
      <h1>Development diagnostics fixture</h1>
      <p>No provider credentials or external services are used.</p>
      <button type="button" onClick={() => setSession((value) => value + 1)}>
        Replace Provider
      </button>
      <m.Provider
        key={session}
        sessionId={SessionId(`fixture-${session}`)}
        connector={connector}
        initialLayout={{
          type: 'tiling',
          tree: [tilingLeafToken(instanceId)],
          instances: [
            {
              instanceId,
              vesselId: VesselId('counter'),
              variant: VariantName('main'),
            },
          ],
        }}
      >
        <Controls />
        <div
          style={{
            width: 600,
            maxWidth: '100%',
            height: 240,
            marginTop: 16,
            background: 'white',
          }}
        >
          <m.Chart />
        </div>
        <m.Devtools />
      </m.Provider>
    </main>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<Preview />);
