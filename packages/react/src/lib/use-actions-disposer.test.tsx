import { useState } from 'react';
import { afterEach, describe, it, expect, mock } from 'bun:test';
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
import type { VesselInstance } from '@maelstrom-co/client';
import type { ActionRunner } from '@maelstrom-co/client';
import type { MaelstromResponse } from '@maelstrom-co/protocol';

import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { resetWarnings } from './warn-once.js';

const orderVessel = defineVessel({
  id: 'orders',
  name: 'Orders',
  description: 'Order management',
  defaultVariant: 'list',
  variants: {
    list: {
      props: { view: 'list' as const },
      minSize: { width: 2, height: 2 },
      actions: [{ name: 'refresh', description: 'Refresh' }],
    },
  },
});

const calendarVessel = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description: 'Calendar view',
  defaultVariant: 'month',
  variants: {
    month: {
      props: { view: 'month' as const },
      minSize: { width: 2, height: 2 },
      actions: [{ name: 'next', description: 'Next month' }],
    },
  },
});

const orderEntry = vessel(orderVessel, () => null);
const calendarEntry = vessel(calendarVessel, () => null);

afterEach(() => {
  cleanup();
  resetWarnings();
});

function makeInstance(override?: Partial<VesselInstance>): VesselInstance {
  return {
    instanceId: InstanceId('inst-1'),
    vesselId: VesselId('orders'),
    variant: VariantName('list'),
    position: { column: 0, row: 0 },
    size: { width: 2, height: 2 },
    ...override,
  };
}

function makeResponse(
  instances: VesselInstance[],
  executionPlan: Array<{
    instanceId: string;
    action: string;
    params?: Record<string, unknown>;
  }> = [],
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

describe('useActions vesselId validation', () => {
  it('warns when instance vesselId does not match provided vesselId', async () => {
    const m = createMaelstrom({
      vessels: [orderEntry, calendarEntry],
      debug: true,
    });

    const warnSpy = mock(() => {});
    const originalWarn = console.warn;
    console.warn = warnSpy;

    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    const runner: ActionRunner<typeof calendarVessel> = {
      next: () => ok(undefined),
    };

    let state: { processIntent: (i: string) => Promise<void> } | undefined;

    function App() {
      state = m.useMaelstrom();
      // Instance inst-1 belongs to 'orders' but we pass 'calendar'
      m.useActions('calendar', 'inst-1', runner);
      return null;
    }

    try {
      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <App />
          </m.Provider>,
        );
      });

      // Trigger a response so the instance appears in the store
      await act(async () => {
        await state!.processIntent('show orders');
      });

      const warnCalls = warnSpy.mock.calls.map((c: any) => c[0]);
      const mismatchWarning = warnCalls.find(
        (msg: string) =>
          typeof msg === 'string' &&
          msg.includes('belongs to vessel "orders"') &&
          msg.includes('not "calendar"'),
      );
      expect(mismatchWarning).toBeDefined();
    } finally {
      console.warn = originalWarn;
    }
  });

  it('registers runner even when vesselId validation warns', async () => {
    const m = createMaelstrom({
      vessels: [orderEntry, calendarEntry],
      debug: true,
    });

    const originalWarn = console.warn;
    console.warn = mock(() => {});

    const connector = createMockConnector({
      process: async () =>
        makeResponse([makeInstance()], [
          { instanceId: 'inst-1', action: 'refresh' },
        ]),
    });

    // Use a runner for 'orders' actions so the handler is found
    const refreshHandler = mock(() => ok(undefined));
    const runner: ActionRunner<typeof orderVessel> = {
      refresh: refreshHandler,
    };

    let state: { processIntent: (i: string) => Promise<void> } | undefined;

    function App() {
      state = m.useMaelstrom();
      // Pass 'calendar' for vesselId but register handler for 'orders' actions
      m.useActions('calendar' as any, 'inst-1', runner);
      return null;
    }

    try {
      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <App />
          </m.Provider>,
        );
      });

      // Trigger action execution
      await act(async () => {
        await state!.processIntent('refresh orders');
      });

      // Runner should have been registered and called despite vesselId mismatch
      expect(refreshHandler).toHaveBeenCalledTimes(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('useActions disposer identity check', () => {
  it('unmounting first component does not remove second component\'s runner', async () => {
    const m = createMaelstrom({
      vessels: [orderEntry],
    });

    let requestCount = 0;
    const connector = createMockConnector({
      process: async () => {
        requestCount++;
        // First request: just register instance. Second: also execute action.
        return makeResponse(
          [makeInstance()],
          requestCount >= 2
            ? [{ instanceId: 'inst-1', action: 'refresh' }]
            : [],
        );
      },
    });

    const handlerA = mock(() => ok(undefined));
    const runnerA: ActionRunner<typeof orderVessel> = { refresh: handlerA };

    const handlerB = mock(() => ok(undefined));
    const runnerB: ActionRunner<typeof orderVessel> = { refresh: handlerB };

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let setShowA: (v: boolean) => void;

    function ComponentA() {
      m.useActions('orders', 'inst-1', runnerA);
      return null;
    }

    function ComponentB() {
      m.useActions('orders', 'inst-1', runnerB);
      return null;
    }

    function App() {
      state = m.useMaelstrom();
      const [showA, _setShowA] = useState(true);
      setShowA = _setShowA;
      return (
        <>
          {showA && <ComponentA />}
          <ComponentB />
        </>
      );
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Register the instance in the store
    await act(async () => {
      await state!.processIntent('show orders');
    });

    // Unmount ComponentA — its disposer should NOT remove ComponentB's runner
    await act(() => setShowA!(false));

    // Trigger an action — ComponentB's handler should still be registered
    await act(async () => {
      await state!.processIntent('refresh orders');
    });

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });
});
