// biome-ignore lint/style/noRestrictedImports: This browser fixture is a composition root outside the published server runtime.
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
// biome-ignore lint/style/noRestrictedImports: This browser fixture is a composition root outside the published server runtime.
import { createDevtools, mountDevtools } from '@maelstrom-co/devtools';
// biome-ignore lint/style/noRestrictedImports: This browser fixture is a composition root outside the published server runtime.
import { connectDevtoolsBridge } from '@maelstrom-co/devtools/mcp-bridge';
import { MessageId } from '@maelstrom-co/protocol';

const connector: EngineConnector = {
  capabilities: { voice: false, streaming: false, stateful: false },
  connect: async () => {},
  disconnect: async () => {},
  subscribe: () => () => {},
  process: async () => {
    throw new Error('This fixture does not call an Engine.');
  },
  addAssistantMessage: async () => {},
  getHistory: async () => [],
};
const tools = createDevtools({ initialIsOpen: true });
const app = new Orchestrator(connector);
const detach = tools.attach(app);
const unmount = mountDevtools(tools);
const file = document.querySelector<HTMLInputElement>('#pairing');
const status = document.querySelector<HTMLOutputElement>('#status');
let release = () => {};
const abort = new AbortController();
document.querySelector('#connect')?.addEventListener('click', async () => {
  const selected = file?.files?.[0];
  if (!selected || !status) return;
  if (selected.size > 8192) {
    status.textContent = 'Choose the pairing file from the local MCP process.';
    return;
  }
  release();
  try {
    const configuration: unknown = JSON.parse(await selected.text());
    if (
      typeof configuration !== 'object' ||
      configuration === null ||
      !('endpoint' in configuration) ||
      typeof configuration.endpoint !== 'string' ||
      !('token' in configuration) ||
      typeof configuration.token !== 'string'
    )
      throw new Error('Invalid pairing file.');
    release = await connectDevtoolsBridge(tools, {
      endpoint: configuration.endpoint,
      token: configuration.token,
      signal: abort.signal,
    });
    status.textContent = 'Paired. Use list_targets in your MCP host.';
  } catch {
    status.textContent =
      'Pairing failed. Check the MCP process, origin, and pairing file.';
  }
  if (file) file.value = '';
});
document.querySelector('#sample')?.addEventListener('click', () => {
  const requestId = MessageId();
  app.diagnostics.emitDiagnostic(
    'client.request.started',
    {},
    undefined,
    requestId,
  );
  app.diagnostics.emitDiagnostic(
    'client.request.failed',
    { durationMs: 12, errorCategory: 'transport' },
    undefined,
    requestId,
  );
});
window.addEventListener(
  'pagehide',
  () => {
    abort.abort();
    release();
    unmount();
    detach();
    tools.dispose();
    void app.dispose();
  },
  { once: true },
);
