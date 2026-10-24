import type { ActionRunner, PushConnector } from '@maelstrom-co/client';
import { type MaelstromResponse, ok } from '@maelstrom-co/protocol';
import {
  createMaelstrom,
  type TypedVesselProps,
  vessel,
} from '@maelstrom-co/react';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RecordSchema } from './contracts.js';
import { notes } from './planner.js';
import { decode, frontendCall, runRequest, toolHistory } from './wire.js';
import { FixtureStore, Workspace } from './workspace.js';

let push: ((response: MaelstromResponse) => void) | undefined;
const connector: PushConnector = {
  capabilities: { voice: false, streaming: false, stateful: false },
  connect: async () => {},
  disconnect: async () => {},
  subscribe: () => () => {},
  getHistory: async () => [],
  addAssistantMessage: async () => {},
  process: async () => {
    throw new Error('Use the AG-UI goal button');
  },
  onPushMessage: (callback) => {
    push = callback;
    return () => {
      push = undefined;
    };
  },
};
const store = new FixtureStore();
let workspace: Workspace | undefined;
const m = createMaelstrom({ vessels: [vessel(notes, Notes)] }).with((ctx) => {
  ctx.onOrchestrator?.((orchestrator) => {
    workspace = new Workspace(store, {
      binding: {
        orchestrator,
        push: (response) => {
          if (!push) throw new Error('Disconnected');
          push(response);
        },
      },
    });
    return () => {
      workspace = undefined;
    };
  });
  return {};
});

function Notes({ instanceId }: TypedVesselProps<typeof notes>) {
  const [record, setRecord] = useState('No record');
  const [focused, setFocused] = useState(false);
  const runner = useMemo<ActionRunner<typeof notes>>(
    () => ({
      create: async () => {
        const response = await fetch('/record', { method: 'POST' });
        if (!response.ok) throw new Error('Create failed');
        store.record = RecordSchema.parse(await response.json());
        store.creates++;
        setRecord(store.record.id);
        return ok(undefined);
      },
      focus: (params) => {
        store.focus(params);
        setFocused(true);
        return ok(undefined);
      },
    }),
    [],
  );
  m.useActions('notes', instanceId, runner);
  return (
    <section aria-label="Notes Vessel">
      <h2>Notes / list Variant</h2>
      <p data-testid="record">{record}</p>
      <p data-testid="focus">
        {focused ? 'Focused exact ID and version' : 'Waiting for focus'}
      </p>
    </section>
  );
}

function App() {
  const [status, setStatus] = useState('Ready');
  const [evidence, setEvidence] = useState('');
  const { connectionStatus } = m.useMaelstrom();
  async function run() {
    setStatus('Running');
    try {
      if (!workspace) throw new Error('Provider not mounted');
      let body = runRequest([
        {
          id: 'goal',
          role: 'user',
          content: 'Create a note and focus the new record.',
        },
      ]);
      for (let run = 1; run <= 3; run++) {
        const events = await decode(
          await fetch('/run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
        const call = frontendCall(events);
        if (!call) {
          if (run !== 3 || !store.focused)
            throw new Error('Goal ended before focus settled');
          break;
        }
        if (run === 3) throw new Error('Goal exceeded the fixture run budget');
        const ack = await workspace.apply(call.id, call.input);
        if (ack.status !== 'applied')
          throw new Error(`Action outcome: ${ack.status}`);
        body = runRequest(
          [
            ...toolHistory(events),
            {
              id: `result-${call.id}`,
              role: 'tool',
              toolCallId: call.id,
              content: JSON.stringify(ack),
            },
          ],
          run + 1,
        );
      }
      setEvidence(
        JSON.stringify(
          {
            commands: workspace.commands,
            snapshot: workspace.snapshot(),
            creates: store.creates,
            record: store.record,
            focused: store.focused,
          },
          null,
          2,
        ),
      );
      setStatus('Complete');
    } catch (error) {
      setStatus(`Failed: ${String(error)}`);
    }
  }
  return (
    <>
      <h1>AG-UI → Maelstrom</h1>
      <p>One goal creates a note, reads its ID, then focuses it.</p>
      <button
        type="button"
        disabled={connectionStatus !== 'connected' || status !== 'Ready'}
        onClick={run}
      >
        Run one goal
      </button>
      <p role="status">{status}</p>
      <div id="chart">
        <m.Chart />
      </div>
      <pre data-testid="evidence">{evidence}</pre>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing root');
createRoot(root).render(
  <m.Provider connector={connector}>
    <App />
  </m.Provider>,
);
