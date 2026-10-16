// @vitest-environment happy-dom

import type { EngineConnector, Orchestrator } from '@maelstrom-co/client';
import { createMaelstrom } from '@maelstrom-co/react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createDemoTelemetry } from './demo-telemetry';

const owners: Array<ReturnType<typeof createDemoTelemetry>> = [];
afterEach(async () => {
  cleanup();
  for (const owner of owners.splice(0)) await owner.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const connector: EngineConnector = {
  capabilities: { voice: false, streaming: false, stateful: false },
  connect: async () => {},
  disconnect: async () => {},
  subscribe: () => () => {},
  addAssistantMessage: async () => {},
  getHistory: async () => [],
  process: async (request) => ({
    type: 'maelstrom_response',
    requestId: request.id,
    layout: { type: 'grid', positions: [] },
    executionPlan: [],
    rationale: 'private response text',
    userMessage: 'private message',
  }),
};

async function mountClient(owner: ReturnType<typeof createDemoTelemetry>) {
  const m = createMaelstrom({ vessels: [] })
    .with(owner.extension)
    .with((context) => ({ useClient: context.useMaelstromContext }));
  let client!: Orchestrator;
  function Probe() {
    client = m.useClient().orchestrator;
    return null;
  }
  const view = render(
    <m.Provider connector={connector}>
      <Probe />
    </m.Provider>,
  );
  await waitFor(() =>
    expect(client.connectionManager.store.state.connectionStatus).toBe(
      'connected',
    ),
  );
  return { client, view };
}

it('real Provider requests reach the local sink without exporting prompt or response content', async () => {
  const log = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const owner = createDemoTelemetry();
  owners.push(owner);
  const { client } = await mountClient(owner);
  await act(async () => {
    await client.processIntent('private request text');
    await client.commandProcessor.waitForIdle();
  });
  await owner.telemetry.flush();
  const snapshot = owner.telemetry.getSnapshot();
  expect(snapshot.accepted).toBeGreaterThan(0);
  expect(snapshot.delivered).toBe(snapshot.accepted);
  expect(snapshot.queued).toBe(0);
  const output = JSON.stringify(log.mock.calls);
  expect(output).toContain('demo.telemetry.batch');
  expect(output).toContain('client.request');
  expect(output).toContain('client.apply');
  expect(output).not.toContain('private');
});

it('Provider teardown releases observation while the page owner keeps counts across remounts', async () => {
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  const owner = createDemoTelemetry();
  owners.push(owner);
  const first = await mountClient(owner);
  await act(async () => {
    await first.client.processIntent('first');
  });
  await owner.telemetry.flush();
  const accepted = owner.telemetry.getSnapshot().accepted;
  expect(accepted).toBeGreaterThan(0);
  first.view.unmount();
  expect(first.client.diagnostics.locallyObserved).toBe(false);
  expect(owner.telemetry.enabled).toBe(true);
  expect(owner.telemetry.getSnapshot().accepted).toBe(accepted);
  const second = await mountClient(owner);
  await act(async () => {
    await second.client.processIntent('second');
  });
  await owner.dispose();
  const final = owner.telemetry.getSnapshot();
  expect(final.accepted).toBeGreaterThan(accepted);
  expect(final.delivered).toBe(final.accepted);
  expect(final.state).toBe('disposed');
  expect(second.client.diagnostics.locallyObserved).toBe(false);
  await act(async () => {
    await second.client.processIntent('after disposal');
  });
  expect(owner.telemetry.getSnapshot()).toEqual(final);
});

it('server-side construction creates no active telemetry or Provider observer', async () => {
  vi.stubGlobal('window', undefined);
  const owner = createDemoTelemetry();
  owners.push(owner);
  const register = vi.fn();
  owner.extension({
    onOrchestrator: register,
    useMaelstromContext: () => {
      throw new Error('No browser Provider');
    },
  });
  expect(owner.telemetry.enabled).toBe(false);
  expect(register).not.toHaveBeenCalled();
  await owner.dispose();
  expect(owner.telemetry.getSnapshot().state).toBe('disabled');
});
