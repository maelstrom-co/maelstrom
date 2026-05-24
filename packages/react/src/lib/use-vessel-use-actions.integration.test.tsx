/**
 * Integration tests: useVessel + useActions working together.
 *
 * These tests verify the full round-trip:
 * - Engine response populates vessel instance
 * - useVessel returns typed props
 * - useActions registers runner
 * - Engine-initiated action fires runner handler
 * - User-initiated executeAction triggers optimistic transition AND fires runner
 */
import { describe, it, expect, afterEach, mock } from 'bun:test';
import { render, cleanup, act } from '@testing-library/react';
import {
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
      action: e.action,
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props).not.toBeNull();
    expect(props!.variantProps.variant).toBe('list');

    await act(async () => {
      await state!.processIntent('view order 99');
    });

    expect(viewDetailHandler).toHaveBeenCalledTimes(1);
    expect(viewDetailHandler).toHaveBeenCalledWith({ orderId: 'order-99' });
  });

  it('user-initiated executeAction triggers optimistic transition and fires registered runner', async () => {
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props!.variantProps.variant).toBe('list');

    // User calls executeAction — optimistic transition fires immediately
    // ActionManager also notified (runner fires)
    await act(async () => {
      props!.executeAction('viewDetail', { orderId: 'order-1' });
    });

    expect(props!.variantProps.variant).toBe('detail');
    expect(viewDetailHandler).toHaveBeenCalledTimes(1);
    expect(viewDetailHandler).toHaveBeenCalledWith({ orderId: 'order-1' });
  });
});
