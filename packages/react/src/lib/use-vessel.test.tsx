import { afterEach, describe, expect, it } from 'bun:test';
import type { VesselInstance } from '@maelstrom-co/client';
import type { MaelstromResponse } from '@maelstrom-co/protocol';
import {
  defineVessel,
  err,
  InstanceId,
  MessageId,
  ok,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { type ReactNode, useMemo } from 'react';
import { assertDefined } from './__tests__/assert-defined.js';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';

// Vessel with transitionsTo so we can test client-authoritative variant transitions
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
        {
          name: 'viewDetail',
          description: 'View detail',
          transitionsTo: 'detail',
        },
        { name: 'refresh', description: 'Refresh' },
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

function makeResponse(
  instances: VesselInstance[],
  executionPlan: MaelstromResponse['executionPlan'] = [],
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: MessageId('req-1'),
    userMessage: '',
    rationale: '',
    executionPlan,
    // TilingLayout carries vesselId + variant directly on instances
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

// ─── Basic behavior ──────────────────────────────────────────────────────────

describe('m.useVessel() — basic', () => {
  it('returns null when instance does not exist in store', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVessel('orders', 'inst-1'), {
      wrapper,
    });

    await act(async () => {});

    expect(result.current).toBeNull();
  });

  it('returns null (does not throw during render) for an empty instanceId', async () => {
    // Empty/whitespace ids must degrade to the hook's not-found path, not a
    // render-time throw — branding the id at the seam must not crash the tree.
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <m.Provider connector={connector}>{children}</m.Provider>
    );

    const { result } = renderHook(() => m.useVessel('orders', ''), { wrapper });

    await act(async () => {});

    expect(result.current).toBeNull();
  });

  it('returns null when instance vesselId does not match requested vesselId', async () => {
    const weatherVessel = defineVessel({
      id: 'weather',
      name: 'Weather',
      description: 'Weather vessel',
      defaultVariant: 'compact',
      variants: {
        compact: {
          props: { city: '' },
          minSize: { width: 1, height: 1 },
          actions: [],
        },
      },
    });
    const weatherEntry = vessel(weatherVessel, () => null);
    const m = createMaelstrom({ vessels: [entry, weatherEntry] });

    // Engine returns an 'orders' instance — querying for 'weather' on same instanceId should be null
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let weatherProps: ReturnType<typeof m.useVessel<'weather'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      weatherProps = m.useVessel('weather', 'inst-1');
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

    // inst-1 belongs to 'orders', not 'weather'
    expect(weatherProps).toBeNull();
  });

  it('returns typed props when instance exists with matching vesselId', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
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
    expect(props.variantProps.variant).toBe('list');
    expect((props.variantProps as { variant: 'list'; view: string }).view).toBe(
      'list',
    );
    expect(typeof props.executeAction).toBe('function');
  });

  it('returns null when instance is removed from store', async () => {
    let callCount = 0;
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        // First call: instance present; second call: empty layout
        return callCount === 1
          ? makeResponse([makeInstance()])
          : makeResponse([]);
      },
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
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

    assertDefined(state);
    const stateSnapshot2 = state;
    await act(async () => {
      await stateSnapshot2.processIntent('remove orders');
    });
    expect(props).toBeNull();
  });
});

// ─── Store-authoritative transitions ─────────────────────────────────────────
// executeAction applies a vessel's `transitionsTo` variant to the client store
// synchronously, so the observable instant flip happens client-side.

describe('m.useVessel() — store-authoritative transitions', () => {
  it('executeAction with transitionsTo immediately updates variantProps.variant', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
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

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
    const propsSnapshot = props;

    // viewDetail has transitionsTo: 'detail' — should be immediate
    await act(async () => {
      propsSnapshot.executeAction('viewDetail');
    });

    assertDefined(props);
    expect(props.variantProps.variant).toBe('detail');
  });

  it('executeAction without transitionsTo does not change variant', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
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

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
    const propsSnapshot = props;

    // 'refresh' has no transitionsTo
    await act(async () => {
      propsSnapshot.executeAction('refresh');
    });

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
  });

  it('engine confirmation keeps the client-transitioned variant', async () => {
    let callCount = 0;
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        // First: 'list' instance; second: engine confirms 'detail'
        const variant = VariantName(callCount === 1 ? 'list' : 'detail');
        return makeResponse([makeInstance({ variant })]);
      },
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
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

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
    const propsSnapshot = props;

    // Client transition to 'detail' (applied to the store synchronously)
    await act(async () => {
      propsSnapshot.executeAction('viewDetail');
    });
    assertDefined(props);
    expect(props.variantProps.variant).toBe('detail');

    // Engine confirms 'detail' — store stays authoritative on 'detail'
    assertDefined(state);
    const stateSnapshot2 = state;
    await act(async () => {
      await stateSnapshot2.processIntent('engine confirms');
    });
    assertDefined(props);
    expect(props.variantProps.variant).toBe('detail');
  });

  it('variantProps reflects the correct props for the transitioned variant', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance()]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
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

    // Before: list variant props
    assertDefined(props);
    expect((props.variantProps as { variant: 'list'; view: string }).view).toBe(
      'list',
    );
    const propsSnapshot = props;

    // Transition to detail
    await act(async () => {
      propsSnapshot.executeAction('viewDetail');
    });

    // After: detail variant props
    assertDefined(props);
    expect(props.variantProps.variant).toBe('detail');
    expect(
      (props.variantProps as { variant: 'detail'; view: string }).view,
    ).toBe('detail');
  });

  it('does not cause extra re-renders when instance updates without an active optimistic variant', async () => {
    let callCount = 0;
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        // Each response changes position, not variant
        const position =
          callCount === 1 ? { column: 0, row: 0 } : { column: 1, row: 1 };
        return makeResponse([makeInstance({ position })]);
      },
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let renderCount = 0;

    function App() {
      state = m.useMaelstrom();
      m.useVessel('orders', 'inst-1');
      renderCount++;
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

    // Baseline: renders caused by the first processIntent (store subscriptions)
    const rendersAfterFirstIntent = renderCount;

    // Position-only update — should cause the same number of renders, no extras
    // from the optimistic clearing effect firing setOptimisticVariant(null) when already null
    renderCount = 0;
    assertDefined(state);
    const stateSnapshot2 = state;
    await act(async () => {
      await stateSnapshot2.processIntent('move orders');
    });

    const rendersForPositionUpdate = renderCount;
    expect(rendersForPositionUpdate).toBeLessThanOrEqual(
      rendersAfterFirstIntent,
    );
  });

  it('engine layout overrides a client transition (reverts to the engine variant)', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => {
        // Both responses return variant: 'list' — the engine layout overrides
        // the client's local 'detail' transition.
        return makeResponse([makeInstance({ variant: VariantName('list') })]);
      },
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
      // Register a runner so executeAction's command doesn't block the queue
      const runner = useMemo(
        () => ({
          viewDetail: () => ok(undefined),
        }),
        [],
      );
      m.useActions('orders', 'inst-1', runner);
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

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
    const propsSnapshot = props;

    // Client transition to 'detail' (store updated synchronously)
    await act(async () => {
      propsSnapshot.executeAction('viewDetail');
    });
    assertDefined(props);
    expect(props.variantProps.variant).toBe('detail');

    // Engine responds but keeps variant at 'list' — its layout is authoritative
    assertDefined(state);
    const stateSnapshot2 = state;
    await act(async () => {
      await stateSnapshot2.processIntent('engine rejects');
    });

    // Store variant falls back to the engine's 'list'
    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
  });

  it('optimistic variant clears after command queue drains when no runner is registered', async () => {
    const clock = FakeTimers.install({ shouldAdvanceTime: true });
    try {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector({
        process: async () =>
          makeResponse([makeInstance({ variant: VariantName('list') })]),
      });

      let state: { processIntent: (i: string) => Promise<void> } | undefined;
      let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

      function App() {
        state = m.useMaelstrom();
        props = m.useVessel('orders', 'inst-1');
        // No useActions — no runner registered
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
        // Drain the command queue (set_layout + execute_actions with empty plan)
        await clock.tickAsync(0);
      });

      assertDefined(props);
      expect(props.variantProps.variant).toBe('list');
      const propsSnapshot = props;

      // Optimistic transition — no runner, so execute_actions blocks on waitForReady
      await act(async () => {
        propsSnapshot.executeAction('viewDetail');
      });
      assertDefined(props);
      expect(props.variantProps.variant).toBe('detail');

      // Engine responds while command queue is still blocked
      assertDefined(state);
      const stateSnapshot2 = state;
      await act(async () => {
        await stateSnapshot2.processIntent('engine rejects');
      });

      // Optimistic still active — engine response is queued behind the blocked command
      assertDefined(props);
      expect(props.variantProps.variant).toBe('detail');

      // Advance past the 500ms waitForReady timeout to unblock the queue
      await act(async () => {
        await clock.tickAsync(600);
      });

      // Queue drained: engine response processed, optimistic cleared
      assertDefined(props);
      expect(props.variantProps.variant).toBe('list');
    } finally {
      clock.uninstall();
    }
  });

  it('runner failure reverts the client transition', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () =>
        makeResponse([makeInstance({ variant: VariantName('list') })]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
      const runner = useMemo(
        () => ({
          viewDetail: () => err(new Error('action failed')),
        }),
        [],
      );
      m.useActions('orders', 'inst-1', runner);
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

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
    const propsSnapshot = props;

    // executeAction transitions the store to 'detail', but the runner returns Failure
    await act(async () => {
      propsSnapshot.executeAction('viewDetail');
    });

    // Client reverts the transition since the runner failed
    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
  });

  it('runner throw reverts the client transition', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () =>
        makeResponse([makeInstance({ variant: VariantName('list') })]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
      const runner = useMemo(
        () => ({
          viewDetail: () => {
            throw new Error('runner threw');
          },
        }),
        [],
      );
      m.useActions('orders', 'inst-1', runner);
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

    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
    const propsSnapshot = props;

    // executeAction transitions the store to 'detail', but the runner throws
    await act(async () => {
      propsSnapshot.executeAction('viewDetail');
    });

    // Client reverts the transition since the runner threw
    assertDefined(props);
    expect(props.variantProps.variant).toBe('list');
  });

  it('resolves transitionsTo from the active variant, not the first match across all variants', async () => {
    // Vessel where 'toggle' exists on both variants with different transitionsTo
    const toggleVessel = defineVessel({
      id: 'toggle-panel',
      name: 'Toggle Panel',
      description: 'Panel with toggle action on both variants',
      defaultVariant: 'collapsed',
      variants: {
        collapsed: {
          props: { mode: 'collapsed' as const },
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'toggle',
              description: 'Toggle',
              transitionsTo: 'expanded',
            },
          ],
        },
        expanded: {
          props: { mode: 'expanded' as const },
          minSize: { width: 2, height: 2 },
          actions: [
            {
              name: 'toggle',
              description: 'Toggle',
              transitionsTo: 'collapsed',
            },
          ],
        },
      },
    });

    const toggleEntry = vessel(toggleVessel, () => null);
    const m = createMaelstrom({ vessels: [toggleEntry] });

    const connector = createMockConnector({
      process: async () => ({
        type: 'maelstrom_response' as const,
        requestId: MessageId('req-1'),
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: {
          type: 'tiling' as const,
          tree: [],
          instances: [
            {
              instanceId: InstanceId('inst-1'),
              vesselId: VesselId('toggle-panel'),
              variant: VariantName('expanded'),
            },
          ],
        },
      }),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'toggle-panel'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('toggle-panel', 'inst-1');
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
      await stateSnapshot.processIntent('show panel');
    });

    // Instance is on 'expanded' variant
    assertDefined(props);
    expect(props.variantProps.variant).toBe('expanded');
    const propsSnapshot = props;

    // 'toggle' on expanded should transition to 'collapsed', not 'expanded'
    await act(async () => {
      propsSnapshot.executeAction('toggle');
    });

    assertDefined(props);
    expect(props.variantProps.variant).toBe('collapsed');
  });
});
