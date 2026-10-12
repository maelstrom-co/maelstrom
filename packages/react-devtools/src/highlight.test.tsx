import { expect, test } from 'bun:test';
import type { EngineConnector, Orchestrator } from '@maelstrom-co/client';
import { createDevtools } from '@maelstrom-co/devtools/production';
import {
  defineVessel,
  InstanceId,
  SessionId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { createMaelstrom, vessel } from '@maelstrom-co/react';
import { act, cleanup, render, waitFor } from '@testing-library/react';

test('selection highlights only the owning app and replays after its Chart remounts', async () => {
  const previous = globalThis.ResizeObserver;
  // Layout is unmeasured; this test checks scoped selection, not geometry.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: false },
    connect: async () => {},
    disconnect: async () => {},
    subscribe: () => () => {},
    process: async () => {
      throw new Error('unexpected request');
    },
    addAssistantMessage: async () => {},
    getHistory: async () => [],
  };
  const definition = defineVessel({
    id: 'highlight-fixture',
    name: 'Highlight fixture',
    description: 'Selection fixture.',
    defaultVariant: 'main',
    variants: {
      main: { props: {}, minSize: { width: 1, height: 1 }, actions: [] },
    },
  });
  const instanceId = InstanceId('shared-instance');
  const initialLayout = {
    type: 'tiling' as const,
    tree: [tilingLeafToken(instanceId)],
    instances: [
      {
        instanceId,
        vesselId: VesselId(definition.id),
        variant: VariantName('main'),
      },
    ],
  };
  const tools = createDevtools();
  const clients: Orchestrator[] = [];
  const m = createMaelstrom({
    vessels: [vessel(definition, () => <div>Fixture</div>)],
  }).with((context) => {
    context.onOrchestrator?.((client) => {
      clients.push(client);
      return tools.attach(client);
    });
    return {};
  });
  const tree = (firstChart: boolean) => (
    <>
      <div data-testid="first-app">
        <m.Provider
          sessionId={SessionId('app-a')}
          connector={connector}
          initialLayout={initialLayout}
        >
          {firstChart ? <m.Chart /> : null}
        </m.Provider>
      </div>
      <div data-testid="second-app">
        <m.Provider
          sessionId={SessionId('app-b')}
          connector={connector}
          initialLayout={initialLayout}
        >
          <m.Chart />
        </m.Provider>
      </div>
    </>
  );
  try {
    const view = render(tree(true));
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-instance-id="shared-instance"]'),
      ).toHaveLength(2),
    );
    const first = tools
      .getSnapshot()
      .sessions.find((session) => session.sessionId === 'app-a');
    const second = tools
      .getSnapshot()
      .sessions.find((session) => session.sessionId === 'app-b');
    if (!first || !second) throw new Error('Expected separate app lifetimes');
    await act(async () => tools.setHighlightedInstance?.(first.id, instanceId));
    expect(
      document.querySelectorAll('[data-devtools-highlighted]'),
    ).toHaveLength(1);
    expect(
      view
        .getByTestId('first-app')
        .querySelector('[data-devtools-highlighted]'),
    ).not.toBeNull();
    await act(async () =>
      tools.setHighlightedInstance?.(second.id, instanceId),
    );
    expect(
      view
        .getByTestId('first-app')
        .querySelector('[data-devtools-highlighted]'),
    ).toBeNull();
    expect(
      view
        .getByTestId('second-app')
        .querySelector('[data-devtools-highlighted]'),
    ).not.toBeNull();
    view.rerender(tree(false));
    await act(async () => tools.setHighlightedInstance?.(first.id, instanceId));
    view.rerender(tree(true));
    await waitFor(() =>
      expect(
        view
          .getByTestId('first-app')
          .querySelector('[data-devtools-highlighted]'),
      ).not.toBeNull(),
    );
    await act(async () => tools.setHighlightedInstance?.());
    expect(
      document.querySelectorAll('[data-devtools-highlighted]'),
    ).toHaveLength(0);
  } finally {
    cleanup();
    tools.dispose();
    await Promise.all(clients.map((client) => client.dispose()));
    globalThis.ResizeObserver = previous;
  }
});
