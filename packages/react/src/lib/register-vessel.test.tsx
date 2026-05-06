import { useState, useMemo } from 'react';
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { VesselInstance } from '@maelstrom-co/client';
import type { ActionRunner } from '@maelstrom-co/client';
import type {
  MaelstromResponse,
  VariantName,
  Vessel,
  VesselId,
} from '@maelstrom-co/protocol';
import { InstanceId, MessageId, defineVessel } from '@maelstrom-co/protocol';
import { ok } from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';

// Static vessel for baseline
const orderVessel = defineVessel({
  id: 'orders',
  name: 'Orders',
  description: 'Order management',
  defaultVariant: 'list',
  variants: {
    list: {
      props: { view: 'list' as const },
      minSize: { width: 2, height: 2 },
      actions: [],
    },
  },
});
const orderEntry = vessel(orderVessel, () => null);

// Dynamic vessel — not in factory config
const widgetVessel = defineVessel({
  id: 'widget',
  name: 'Widget',
  description: 'Dynamic widget',
  defaultVariant: 'default',
  variants: {
    default: {
      props: { label: 'Hello' },
      minSize: { width: 1, height: 1 },
      actions: [
        { name: 'activate', description: 'Activate', transitionsTo: 'active' },
      ],
    },
    active: {
      props: { label: 'Active' },
      minSize: { width: 2, height: 2 },
      actions: [],
    },
  },
});

afterEach(() => cleanup());

function makeResponse(
  instances: VesselInstance[],
  executionPlan: Array<{ instanceId: string; action: string }> = [],
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId('req-1'),
    userMessage: '',
    rationale: '',
    executionPlan: executionPlan.map((e) => ({
      instanceId: InstanceId(e.instanceId),
      action: e.action,
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

describe('m.registerVessel()', () => {
  it('registers a vessel and returns a handle with typed hooks', async () => {
    const m = createMaelstrom({ vessels: [orderEntry] });
    const widgetEntry = vessel(widgetVessel, () => null);

    const connector = createMockConnector({
      process: async () =>
        makeResponse([
          {
            instanceId: InstanceId('widget-1'),
            vesselId: 'widget' as VesselId,
            variant: 'default' as VariantName,
            position: { column: 0, row: 0 },
            size: { width: 1, height: 1 },
          },
        ]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let widgetProps = null as {
      instanceId: string;
      variantProps: { variant: string };
    } | null;

    function App() {
      state = m.useMaelstrom();

      // Register dynamically inside component
      const handle = useMemo(() => m.registerVessel(widgetEntry), []);
      widgetProps = handle.useVessel('widget-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    await act(async () => {
      await state?.processIntent('show widget');
    });

    expect(widgetProps).not.toBeNull();
    expect(widgetProps?.instanceId).toBe('widget-1');
    expect(widgetProps?.variantProps.variant).toBe('default');
  });

  it('handle.useActions registers a runner for the dynamic vessel', async () => {
    const m = createMaelstrom({ vessels: [orderEntry] });
    const widgetEntry = vessel(widgetVessel, () => null);

    let runnerCalled = false;
    const connector = createMockConnector({
      process: async () =>
        makeResponse([
          {
            instanceId: InstanceId('widget-1'),
            vesselId: 'widget' as VesselId,
            variant: 'default' as VariantName,
            position: { column: 0, row: 0 },
            size: { width: 1, height: 1 },
          },
        ]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let widgetProps: { executeAction: (...args: any[]) => void } | null = null;

    function App() {
      state = m.useMaelstrom();

      const handle = useMemo(() => m.registerVessel(widgetEntry), []);
      widgetProps = handle.useVessel('widget-1');

      const runner = useMemo(
        () => ({
          activate: () => {
            runnerCalled = true;
            return ok(undefined);
          },
        }),
        [],
      );
      handle.useActions('widget-1', runner);
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    await act(async () => {
      await state?.processIntent('show widget');
    });

    await act(async () => {
      widgetProps?.executeAction('activate');
    });

    expect(runnerCalled).toBe(true);
  });

  it('handle.unregister() removes vessel from vesselManager and registries', async () => {
    const m = createMaelstrom({ vessels: [orderEntry] });
    const widgetEntry = vessel(widgetVessel, () => null);

    let callCount = 0;
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        // First call: widget instance present; second call: same response
        return makeResponse([
          {
            instanceId: InstanceId('widget-1'),
            vesselId: 'widget' as VesselId,
            variant: 'default' as VariantName,
            position: { column: 0, row: 0 },
            size: { width: 1, height: 1 },
          },
        ]);
      },
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let handle: { unregister: () => void } | undefined;
    let instanceProps: ReturnType<typeof m.useInstance> | undefined;

    function App() {
      state = m.useMaelstrom();
      handle = useMemo(() => m.registerVessel(widgetEntry), []);
      instanceProps = m.useInstance('widget-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    // Create a widget instance via processIntent
    await act(async () => {
      await state?.processIntent('show widget');
    });

    // Instance should be visible through useInstance (vessel is registered)
    expect(instanceProps).not.toBeNull();
    expect(instanceProps?.vesselId).toBe('widget' as VesselId);

    // Unregister the vessel
    await act(async () => {
      handle?.unregister();
    });

    // useInstance should now return null — vessel definition is gone,
    // so even though the instance still exists in the command processor store,
    // the hook cannot look up variant props without the vessel definition
    expect(instanceProps).toBeNull();
  });

  it('dynamic vessel appears in useInstance for both static and dynamic vessels', async () => {
    const m = createMaelstrom({ vessels: [orderEntry] });
    const widgetEntry = vessel(widgetVessel, () => null);

    const connector = createMockConnector({
      process: async () =>
        makeResponse([
          {
            instanceId: InstanceId('inst-1'),
            vesselId: 'orders' as VesselId,
            variant: 'list' as VariantName,
            position: { column: 0, row: 0 },
            size: { width: 2, height: 2 },
          },
          {
            instanceId: InstanceId('widget-1'),
            vesselId: 'widget' as VesselId,
            variant: 'default' as VariantName,
            position: { column: 3, row: 0 },
            size: { width: 1, height: 1 },
          },
        ]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let orderInstanceProps: ReturnType<typeof m.useInstance> | undefined;
    let widgetInstanceProps: ReturnType<typeof m.useInstance> | undefined;

    function App() {
      state = m.useMaelstrom();
      useMemo(() => m.registerVessel(widgetEntry), []);
      orderInstanceProps = m.useInstance('inst-1');
      widgetInstanceProps = m.useInstance('widget-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    await act(async () => {
      await state?.processIntent('show all');
    });

    expect(orderInstanceProps?.vesselId).toBe('orders' as VesselId);
    expect(widgetInstanceProps?.vesselId).toBe('widget' as VesselId);
  });

  it('handle.useActions disposer does not remove another component\'s runner', async () => {
    const m = createMaelstrom({ vessels: [orderEntry] });
    const widgetEntry = vessel(widgetVessel, () => null);

    const widgetInstance: VesselInstance = {
      instanceId: InstanceId('widget-1'),
      vesselId: 'widget' as VesselId,
      variant: 'default' as VariantName,
      position: { column: 0, row: 0 },
      size: { width: 1, height: 1 },
    };

    let requestCount = 0;
    const connector = createMockConnector({
      process: async () => {
        requestCount++;
        return makeResponse(
          [widgetInstance],
          requestCount >= 2 ? [{ instanceId: InstanceId('widget-1'), action: 'activate' }] : [],
        );
      },
    });

    const handlerA = mock(() => ok(undefined));
    const runnerA: ActionRunner<typeof widgetVessel> = { activate: handlerA };

    const handlerB = mock(() => ok(undefined));
    const runnerB: ActionRunner<typeof widgetVessel> = { activate: handlerB };

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let setShowA: (v: boolean) => void;

    // Shared handle ref — assigned in App, read by children
    let handle: ReturnType<typeof m.registerVessel<typeof widgetVessel>>;

    function ComponentA() {
      handle.useActions('widget-1', runnerA);
      return null;
    }

    function ComponentB() {
      handle.useActions('widget-1', runnerB);
      return null;
    }

    function App() {
      state = m.useMaelstrom();
      handle = useMemo(() => m.registerVessel(widgetEntry), []);
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

    await act(async () => {
      await state!.processIntent('show widget');
    });

    // Unmount ComponentA — its disposer should NOT remove ComponentB's runner
    await act(() => setShowA!(false));

    // Trigger action — ComponentB's handler should still work
    await act(async () => {
      await state!.processIntent('activate widget');
    });

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it('registerVessel throws on invalid vessel', async () => {
    const m = createMaelstrom({ vessels: [orderEntry] });
    const invalidVessel = {
      id: '',
      name: '',
      description: '',
      defaultVariant: '',
      variants: {},
    } as unknown as Vessel;
    const invalidEntry = vessel(invalidVessel, () => null);

    const connector = createMockConnector();

    function App() {
      m.useMaelstrom();
      useMemo(() => m.registerVessel(invalidEntry), []);
      return null;
    }

    expect(() =>
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      ),
    ).toThrow(/registerVessel.*failed validation/);
  });
});
