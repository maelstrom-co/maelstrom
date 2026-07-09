import { afterEach, describe, expect, it } from 'bun:test';
import type { VesselInstance } from '@maelstrom-co/client';
import type { MaelstromResponse } from '@maelstrom-co/protocol';
import {
  ActionName,
  InstanceId,
  MessageId,
  VariantName,
  VesselId,
  defineVessel,
} from '@maelstrom-co/protocol';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { assertDefined } from './__tests__/assert-defined.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';

const orderVessel = defineVessel({
  id: 'orders',
  name: 'Orders',
  description: 'Order management',
  defaultVariant: 'list',
  variants: {
    list: {
      props: { view: 'list' as const, pageSize: 10 },
      minSize: { width: 2, height: 2 },
      actions: [
        { name: 'viewDetail', description: 'View detail', transitionsTo: 'detail' },
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

function makeResponse(instances: VesselInstance[]): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId('req-1'),
    userMessage: '',
    rationale: '',
    executionPlan: [],
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

describe('m.useInstance()', () => {
  it('returns null when instance does not exist', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useInstance('inst-1'), { wrapper });
    await act(async () => {});

    expect(result.current).toBeNull();
  });

  it('returns untyped props when instance exists', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useInstance> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useInstance('inst-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(state);
    const stateSnapshot = state;
    await act(async () => {
      await stateSnapshot.processIntent('show orders');
    });

    expect(props).not.toBeNull();
    assertDefined(props);
    expect(props.instanceId).toBe(InstanceId('inst-1'));
    expect(props.vesselId).toBe(VesselId('orders'));
    expect(props.variantProps.variant).toBe(VariantName('list'));
    expect(typeof props.executeAction).toBe('function');
  });

  it('returns props for any vessel type (no vesselId filtering)', async () => {
    const weatherVessel = defineVessel({
      id: 'weather',
      name: 'Weather',
      description: 'Weather',
      defaultVariant: 'compact',
      variants: {
        compact: {
          props: { city: 'London' },
          minSize: { width: 1, height: 1 },
          actions: [],
        },
      },
    });
    const weatherEntry = vessel(weatherVessel, () => null);
    const m = createMaelstrom({ vessels: [entry, weatherEntry] });

    const connector = createMockConnector({
      process: async () =>
        makeResponse([
          makeInstance(),
          {
            instanceId: InstanceId('weather-1'),
            vesselId: VesselId('weather'),
            variant: VariantName('compact'),
            position: { column: 3, row: 0 },
            size: { width: 1, height: 1 },
          },
        ]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let orderProps: ReturnType<typeof m.useInstance> | undefined;
    let weatherProps: ReturnType<typeof m.useInstance> | undefined;

    function App() {
      state = m.useMaelstrom();
      orderProps = m.useInstance('inst-1');
      weatherProps = m.useInstance('weather-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(state);
    const stateSnapshot = state;
    await act(async () => {
      await stateSnapshot.processIntent('show all');
    });

    assertDefined(orderProps);
    assertDefined(weatherProps);
    expect(orderProps.vesselId).toBe(VesselId('orders'));
    expect(weatherProps.vesselId).toBe(VesselId('weather'));
  });

  it('executeAction dispatches to command processor', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useInstance> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useInstance('inst-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(state);
    const stateSnapshot = state;
    await act(async () => {
      await stateSnapshot.processIntent('show orders');
    });

    // executeAction with transitionsTo triggers optimistic transition
    assertDefined(props);
    const propsSnapshot = props;
    await act(async () => {
      propsSnapshot.executeAction(ActionName('viewDetail'));
    });

    assertDefined(props);
    expect(props.variantProps.variant).toBe(VariantName('detail'));
  });

  it('returns null when instance is removed', async () => {
    let callCount = 0;
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        return callCount === 1
          ? makeResponse([makeInstance()])
          : makeResponse([]);
      },
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useInstance> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useInstance('inst-1');
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <App />
        </m.Provider>,
      );
    });

    assertDefined(state);
    const stateForShow = state;
    await act(async () => {
      await stateForShow.processIntent('show orders');
    });
    expect(props).not.toBeNull();

    assertDefined(state);
    const stateForRemove = state;
    await act(async () => {
      await stateForRemove.processIntent('remove orders');
    });
    expect(props).toBeNull();
  });
});
