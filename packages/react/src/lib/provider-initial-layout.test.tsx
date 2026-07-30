import { afterEach, describe, expect, it } from 'bun:test';
import {
  InstanceId,
  type TilingLayout,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { testVessel } from './__tests__/test-vessel.fixture.js';
import { createMaelstromContext } from './context.js';
import { createProvider } from './provider.js';
import { vessel } from './vessel.js';

const entry = vessel(testVessel, () => null);

const seedLayout: TilingLayout = {
  type: 'tiling',
  tree: [InstanceId('orders-main')],
  instances: [
    {
      instanceId: InstanceId('orders-main'),
      vesselId: VesselId('orders'),
      variant: VariantName('list'),
    },
  ],
};

afterEach(() => cleanup());

describe('Provider initialLayout', () => {
  it('seeds the instance before any engine round-trip', async () => {
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    await act(async () => {
      render(
        <Provider connector={connector} initialLayout={seedLayout}>
          <div />
        </Provider>,
      );
    });

    const orchestrator = contextPair.contextRef.current?.orchestrator;
    const seeded = orchestrator?.commandProcessor.store.state.instances.get(
      InstanceId('orders-main'),
    );
    expect(seeded?.vesselId).toBe(VesselId('orders'));
    expect(seeded?.variant).toBe(VariantName('list'));
  });

  // Regression: the reference implementation this Provider is based on used a
  // `hasSeededRef` to stop a later effect re-run from re-seeding the board.
  // Under StrictMode's mount → cleanup → mount double-invoke, that ref had
  // already flipped to `true` during the first (discarded) mount, so the
  // *surviving* second Orchestrator built with no seed at all — the launch
  // screen silently vanished only in development, only under StrictMode.
  // This Provider carries no such ref: the construction effect depends on
  // `[stableSessionId]` alone and reads `initialLayout` straight from its
  // closure, so both StrictMode passes build from the same closure and seed
  // the same way.
  it('still seeds the surviving Orchestrator when StrictMode double-invokes the mount effect', async () => {
    const contextPair = createMaelstromContext();
    const Provider = createProvider(contextPair, [entry], {});
    const connector = createMockConnector();

    await act(async () => {
      render(
        <StrictMode>
          <Provider connector={connector} initialLayout={seedLayout}>
            <div />
          </Provider>
        </StrictMode>,
      );
    });

    const orchestrator = contextPair.contextRef.current?.orchestrator;
    const seeded = orchestrator?.commandProcessor.store.state.instances.get(
      InstanceId('orders-main'),
    );
    expect(seeded?.vesselId).toBe(VesselId('orders'));
    expect(seeded?.variant).toBe(VariantName('list'));
  });
});
