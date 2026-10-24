import { Orchestrator } from '@maelstrom-co/client';
import {
  createDevtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';

const tools = createDevtools({ initialIsOpen: true, theme: 'dark' });
const heading = document.createElement('h1');
heading.textContent = 'Evidence and setup fixture';
const status = document.createElement('output');
status.setAttribute('aria-label', 'Fixture collection status');
let connections = 0;
let contentReads = 0;
function updateStatus() {
  status.textContent = `Connections: ${connections}. Content reads: ${contentReads}. Recording: ${tools.capture.getSnapshot().active}.`;
}
const client = new Orchestrator({
  capabilities: { voice: false, streaming: false, stateful: false },
  connect: async () => {
    connections++;
    updateStatus();
  },
  disconnect: async () => {},
  subscribe: () => () => {},
  addAssistantMessage: async () => {},
  getHistory: async () => [],
  process: async () => {
    throw new Error('No application work is expected');
  },
});
const release = tools.attach(client);
client.diagnostics.emitDiagnostic(
  'client.request.started',
  {},
  () => {
    contentReads++;
    updateStatus();
    return { intent: 'Fixture request' };
  },
  'fixture-request',
);
const end = document.createElement('button');
end.textContent = 'End fixture app';
end.addEventListener('click', release);
document.body.append(heading, status, end);
document.body.style.cssText =
  'font:16px system-ui;padding:20px;background:#eef2f6';
tools.subscribe(updateStatus);
updateStatus();
tools.importCapture(
  JSON.stringify({
    schemaVersion: 2,
    capture: {
      schemaVersion: 1,
      droppedEvents: 2,
      events: [
        {
          id: 'request',
          kind: 'client.request.started',
          at: 100,
          sessionId: 'fixture',
          requestId: 'request',
          metadata: { clientId: 'recorded-a' },
        },
        {
          id: 'server',
          kind: 'engine.planner.started',
          at: 101,
          sessionId: 'fixture',
          requestId: 'request',
          metadata: { clientId: 'recorded-a' },
        },
        {
          id: 'voice',
          kind: 'voice.transport',
          at: 102,
          sessionId: 'fixture',
          metadata: {
            clientId: 'recorded-b',
            state: 'closed',
            provider: 'fixture',
            providerInstanceId: 'fixture-provider',
            providerGeneration: 1,
          },
        },
      ],
    },
  }),
);
mountDevtools(tools);
