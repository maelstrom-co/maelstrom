import { describe, it, expect, afterEach, mock } from 'bun:test';
import { useState } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import { defineVessel, Success } from '@maelstrom-co/protocol-old';
import type { VesselInstance } from '@maelstrom-co/client';
import type { ActionRunner } from '@maelstrom-co/client';
import type { MaelstromResponse } from '@maelstrom-co/protocol-old';

import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';
import { createMockConnector } from './__tests__/mock-connector.js';

const orderVessel = defineVessel({
  id: 'orders',
  name: 'Orders',
  description: 'Order management',
  defaultVariant: 'list',
  variants: {
    list: {
      props: { view: 'list' as const },
      minSize: { width: 2, height: 2 },
      actions: [
        {
          name: 'selectOrder',
          description: 'Select order',
          parameters: [{ name: 'orderId', type: 'string' as const, description: 'Order ID', required: true as const }],
        },
        { name: 'refresh', description: 'Refresh' },
      ],
    },
    detail: {
      props: { view: 'detail' as const, orderId: '' },
      minSize: { width: 3, height: 3 },
      actions: [{ name: 'close', description: 'Close' }],
    },
  },
});

const entry = vessel(orderVessel, () => null);

afterEach(() => cleanup());

function makeInstance(override?: Partial<VesselInstance>): VesselInstance {
  return {
    instanceId: 'inst-1',
    vesselId: 'orders',
    variant: 'list',
    position: { column: 0, row: 0 },
    size: { width: 2, height: 2 },
    ...override,
  };
}

function makeResponse(
  instances: VesselInstance[],
  executionPlan: Array<{ instanceId: string; action: string; params?: Record<string, unknown> }> = [],
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: 'req-1',
    userMessage: '',
    rationale: '',
    executionPlan: executionPlan as MaelstromResponse['executionPlan'],
    layout: {
      type: 'tiling',
      tree: [],
      instances: instances.map((i) => ({
        instanceId: i.instanceId,
        vesselId: i.vesselId,
        variant: i.variant,
      })),
    },
  };
}

describe('m.useActions()', () => {
  it('registers runner with ActionManager on mount', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const refreshHandler = mock(() => Success(undefined));
    const runner: ActionRunner<typeof orderVessel> = { refresh: refreshHandler };

    // Connector returns an execution plan that fires 'refresh'
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()], [{ instanceId: 'inst-1', action: 'refresh' }]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;

    function App() {
      state = m.useMaelstrom();
      m.useActions('orders', 'inst-1', runner);
      return null;
    }

    await act(async () => {
      render(<m.Provider connector={connector}><App /></m.Provider>);
    });

    await act(async () => {
      await state!.processIntent('refresh orders');
    });

    expect(refreshHandler).toHaveBeenCalledTimes(1);
  });

  it('runner handler receives typed params from engine execution plan', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const selectOrderHandler = mock((_params: { orderId: string }) => Success(undefined));
    const runner: ActionRunner<typeof orderVessel> = { selectOrder: selectOrderHandler };

    const connector = createMockConnector({
      process: async () =>
        makeResponse(
          [makeInstance()],
          [{ instanceId: 'inst-1', action: 'selectOrder', params: { orderId: 'order-42' } }],
        ),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;

    function App() {
      state = m.useMaelstrom();
      m.useActions('orders', 'inst-1', runner);
      return null;
    }

    await act(async () => {
      render(<m.Provider connector={connector}><App /></m.Provider>);
    });

    await act(async () => {
      await state!.processIntent('select order 42');
    });

    expect(selectOrderHandler).toHaveBeenCalledTimes(1);
    expect(selectOrderHandler).toHaveBeenCalledWith({ orderId: 'order-42' });
  });

  it('unregisters runner on unmount so actions are not dispatched after unmount', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const refreshHandler = mock(() => Success(undefined));
    const runner: ActionRunner<typeof orderVessel> = { refresh: refreshHandler };

    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()], [{ instanceId: 'inst-1', action: 'refresh' }]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let hideChild: () => void;

    function Child() {
      m.useActions('orders', 'inst-1', runner);
      return null;
    }

    function App() {
      const [showChild, setShowChild] = useState(true);
      hideChild = () => setShowChild(false);
      state = m.useMaelstrom();
      return showChild ? <Child /> : null;
    }

    await act(async () => {
      render(<m.Provider connector={connector}><App /></m.Provider>);
    });

    // Unmount only the child that calls useActions — provider stays alive
    await act(async () => {
      hideChild!();
    });

    // Runner was unregistered — handler should NOT be called
    await act(async () => {
      await state!.processIntent('refresh after unmount');
    });

    expect(refreshHandler).not.toHaveBeenCalled();
  });

  it('only calls handlers for the registered instance, not other instances', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const refreshHandler = mock(() => Success(undefined));
    const runner: ActionRunner<typeof orderVessel> = { refresh: refreshHandler };

    // Engine fires 'refresh' on inst-2, but runner is registered on inst-1
    const connector = createMockConnector({
      process: async () =>
        makeResponse(
          [makeInstance(), makeInstance({ instanceId: 'inst-2' })],
          [{ instanceId: 'inst-2', action: 'refresh' }],
        ),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;

    function App() {
      state = m.useMaelstrom();
      m.useActions('orders', 'inst-1', runner); // registered on inst-1 only
      return null;
    }

    await act(async () => {
      render(<m.Provider connector={connector}><App /></m.Provider>);
    });

    await act(async () => {
      await state!.processIntent('refresh inst-2');
    });

    // Handler not called — it's for inst-1, not inst-2
    expect(refreshHandler).not.toHaveBeenCalled();
  });
});
