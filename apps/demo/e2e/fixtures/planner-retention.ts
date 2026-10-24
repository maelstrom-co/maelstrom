import { Orchestrator } from '@maelstrom-co/client';
import {
  createDevtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';

const scenario = new URL(location.href).searchParams.get('scenario');
const comparing = scenario === 'comparison-a' || scenario === 'comparison-b';
const tools = createDevtools({
  initialIsOpen: true,
  maxRequestEvents: comparing ? 52 : 51,
  maxActivityEvents: 1,
});
const client = new Orchestrator({
  capabilities: { voice: false, streaming: false, stateful: false },
  connect: async () => {},
  disconnect: async () => {},
  subscribe: () => () => {},
  addAssistantMessage: async () => {},
  getHistory: async () => [],
  process: async () => {
    throw new Error('No application work is expected');
  },
});
tools.attach(client);
let nextModel = 0;
const emitModel = () =>
  client.diagnostics.emitDiagnostic(
    'engine.llm.call',
    { 'gen_ai.request.model': `model-${nextModel++}` },
    undefined,
    'active',
  );
if (comparing)
  client.diagnostics.emitDiagnostic(
    'engine.llm.call',
    { 'gen_ai.request.model': 'other-model' },
    undefined,
    'other',
  );
for (let index = 0; index < 51; index++) emitModel();
mountDevtools(tools);
document.addEventListener('keydown', (event) => {
  if (!event.altKey || event.key.toLowerCase() !== 'n') return;
  event.preventDefault();
  if (scenario === 'controls')
    client.diagnostics.emitDiagnostic(
      'engine.stage.completed',
      { stage: 'layout' },
      undefined,
      'active',
    );
  else for (let count = 0; count < (comparing ? 2 : 1); count++) emitModel();
});
