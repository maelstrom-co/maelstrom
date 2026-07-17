/**
 * Integration tests: useVessel + useActions working together.
 *
 * These tests verify the full round-trip:
 * - Engine response populates vessel instance
 * - useVessel returns typed props
 * - useActions registers runner
 * - Engine-initiated action fires runner handler
 * - User-initiated executeAction triggers the client store transition AND fires runner
 */
import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, cleanup, act } from '@testing-library/react';
import {
  ActionName,
  InstanceId,
  MessageId,
  VariantName,
  VesselId,
  defineVessel,
} from '@maelstrom-co/protocol';
import { ok } from '@maelstrom-co/protocol';
import type { VesselInstance, ActionRunner } from '@maelstrom-co/client';
import type { MaelstromResponse } from '@maelstrom-co/protocol';

import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { assertDefined } from './__tests__/assert-defined.js';

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
          name: 'viewDetail',
          description: 'View detail',
          transitionsTo: 'detail',
          parameters: [{ name: 'orderId', type: 'string' as const, description: 'Order ID', required: true as const }],
        },
      ],
    },
    detail: {
      props: { view: 'detail' as const, orderId: '' },
      minSize: { width: 3, height: 3 },
      actions: [{ name: 'close', description: 'Close', transitionsTo: 'list' }],
    },
  },
});

const entry = vessel(orderVessel, () => null);

afterEach(() => cleanup());

function makeResponse(
  instances: VesselInstance[],
  executionPlan: Array<{ instanceId: string; action: string; params?: Record<string, unknown> }> = [],
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId('req-1'),
    userMessage: '',
    rationale: '',
    executionPlan: executionPlan.map((e) => ({
      instanceId: InstanceId(e.instanceId),
      action: ActionName(e.action),
      ...(e.params && { params: e.params }),
    })),
    layout: {
      type: 'tiling',
      tree: [],
      instances: instances.map((i) => ({
        instanceId: InstanceId(i.instanceId),
        vesselId: i.vesselId,
        variant: i.variant,
      })),
    },
  };
}

const baseInstance: VesselInstance = {
  instanceId: InstanceId('inst-1'),
  vesselId: VesselId('orders'),
  variant: VariantName('list'),
  position: { column: 0, row: 0 },
  size: { width: 2, height: 2 },
};

describe('useVessel + useActions integration', () => {
  it('engine-initiated action fires registered runner with correct params', async () => {
    const viewDetailHandler = mock((_params: { orderId: string }) => ok(undefined));
    const runner: ActionRunner<typeof orderVessel> = { viewDetail: viewDetailHandler };
    const m = createMaelstrom({ vessels: [entry] });

    let callCount = 0;
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        if (callCount === 1) return makeResponse([baseInstance]);
        return makeResponse(
          [baseInstance],
          [{ instanceId: 'inst-1', action: 'viewDetail', params: { orderId: 'order-99' } }],
        );
      },
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
      m.useActions('orders', 'inst-1', runner);
      return null;
    }

    await act(async () => {
      render(<m.Provider connector={connector}><App /></m.Provider>);
    });

    assertDefined(state);
    const stateAfterMount = state;
    await act(async () => {
      await stateAfterMount.processIntent('show orders');
    });

    expect(props).not.toBeNull();
    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');

    assertDefined(state);
    const stateAfterList = state;
    await act(async () => {
      await stateAfterList.processIntent('view order 99');
    });

    expect(viewDetailHandler).toHaveBeenCalledTimes(1);
    expect(viewDetailHandler).toHaveBeenCalledWith({ orderId: 'order-99' });
  });

  it('user-initiated executeAction triggers the client transition and fires registered runner', async () => {
    const viewDetailHandler = mock((_params: { orderId: string }) => ok(undefined));
    const runner: ActionRunner<typeof orderVessel> = { viewDetail: viewDetailHandler };
    const m = createMaelstrom({ vessels: [entry] });

    const connector = createMockConnector({
      process: async () => makeResponse([baseInstance]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
      m.useActions('orders', 'inst-1', runner);
      return null;
    }

    await act(async () => {
      render(<m.Provider connector={connector}><App /></m.Provider>);
    });

    assertDefined(state);
    const stateAfterMount = state;
    await act(async () => {
      await stateAfterMount.processIntent('show orders');
    });

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');

    // User calls executeAction — client applies the store transition synchronously
    // ActionManager also notified (runner fires)
    assertDefined(props);
    const propsAfterList = props;
    await act(async () => {
      propsAfterList.executeAction('viewDetail', { orderId: 'order-1' });
    });

    assertDefined(props);
    expect(props.variantProps.variant).toBe('detail');
    expect(viewDetailHandler).toHaveBeenCalledTimes(1);
    expect(viewDetailHandler).toHaveBeenCalledWith({ orderId: 'order-1' });
  });
});
