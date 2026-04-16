import { afterEach, describe, expect, it } from 'bun:test';
import type { VesselInstance } from '@maelstrom-co/client';
import type { MaelstromResponse } from '@maelstrom-co/protocol-old';
import { Err, defineVessel, Success } from '@maelstrom-co/protocol-old';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { type ReactNode, useMemo } from 'react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';
import { vessel } from './vessel.js';

// Vessel with transitionsTo so we can test optimistic transitions
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
  executionPlan: MaelstromResponse['executionPlan'] = [],
): MaelstromResponse {
  return {
    type: 'maelstrom_response',
    requestId: 'req-1',
    userMessage: '',
    rationale: '',
    executionPlan,
    // TilingLayout carries vesselId + variant directly on instances
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

    await act(async () => {
      await state!.processIntent('show orders');
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props).not.toBeNull();
    expect(props!.instanceId).toBe('inst-1');
    expect(props!.variantProps.variant).toBe('list');
    expect(
      (props!.variantProps as { variant: 'list'; view: string }).view,
    ).toBe('list');
    expect(typeof props!.executeAction).toBe('function');
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

    await act(async () => {
      await state!.processIntent('show orders');
    });
    expect(props).not.toBeNull();

    await act(async () => {
      await state!.processIntent('remove orders');
    });
    expect(props).toBeNull();
  });
});

// ─── Optimistic transitions ──────────────────────────────────────────────────

describe('m.useVessel() — optimistic transitions', () => {
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props!.variantProps.variant).toBe('list');

    // viewDetail has transitionsTo: 'detail' — should be immediate
    await act(async () => {
      props!.executeAction('viewDetail');
    });

    expect(props!.variantProps.variant).toBe('detail');
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props!.variantProps.variant).toBe('list');

    // 'refresh' has no transitionsTo
    await act(async () => {
      props!.executeAction('refresh');
    });

    expect(props!.variantProps.variant).toBe('list');
  });

  it('optimistic variant is cleared when engine updates the store variant', async () => {
    let callCount = 0;
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        // First: 'list' instance; second: engine confirms 'detail'
        const variant = callCount === 1 ? 'list' : 'detail';
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props!.variantProps.variant).toBe('list');

    // Optimistic transition to 'detail'
    await act(async () => {
      props!.executeAction('viewDetail');
    });
    expect(props!.variantProps.variant).toBe('detail');

    // Engine confirms 'detail' — optimistic state clears, store drives
    await act(async () => {
      await state!.processIntent('engine confirms');
    });
    expect(props!.variantProps.variant).toBe('detail');
  });

  it('variantProps reflects the correct props for the optimistically transitioned variant', async () => {
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    // Before: list variant props
    expect(
      (props!.variantProps as { variant: 'list'; view: string }).view,
    ).toBe('list');

    // Transition to detail
    await act(async () => {
      props!.executeAction('viewDetail');
    });

    // After: detail variant props
    expect(props!.variantProps.variant).toBe('detail');
    expect(
      (props!.variantProps as { variant: 'detail'; view: string }).view,
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    // Baseline: renders caused by the first processIntent (store subscriptions)
    const rendersAfterFirstIntent = renderCount;

    // Position-only update — should cause the same number of renders, no extras
    // from the optimistic clearing effect firing setOptimisticVariant(null) when already null
    renderCount = 0;
    await act(async () => {
      await state!.processIntent('move orders');
    });

    const rendersForPositionUpdate = renderCount;
    expect(rendersForPositionUpdate).toBeLessThanOrEqual(
      rendersAfterFirstIntent,
    );
  });

  it('optimistic variant is cleared when engine rejects the transition (same variant)', async () => {
    let callCount = 0;
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => {
        callCount++;
        // Both responses return variant: 'list' — engine rejects the optimistic 'detail'
        return makeResponse([makeInstance({ variant: 'list' })]);
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
          viewDetail: () => Success(undefined),
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props!.variantProps.variant).toBe('list');

    // Optimistic transition to 'detail'
    await act(async () => {
      props!.executeAction('viewDetail');
    });
    expect(props!.variantProps.variant).toBe('detail');

    // Engine responds but keeps variant at 'list' — rejects the transition
    await act(async () => {
      await state!.processIntent('engine rejects');
    });

    // Optimistic variant should be cleared, falling back to store's 'list'
    expect(props!.variantProps.variant).toBe('list');
  });

  it('optimistic variant clears after command queue drains when no runner is registered', async () => {
    const clock = FakeTimers.install({ shouldAdvanceTime: true });
    try {
      const m = createMaelstrom({ vessels: [entry] });
      const connector = createMockConnector({
        process: async () => makeResponse([makeInstance({ variant: 'list' })]),
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

      await act(async () => {
        await state!.processIntent('show orders');
        // Drain the command queue (set_layout + execute_actions with empty plan)
        await clock.tickAsync(0);
      });

      expect(props!.variantProps.variant).toBe('list');

      // Optimistic transition — no runner, so execute_actions blocks on waitForReady
      await act(async () => {
        props!.executeAction('viewDetail');
      });
      expect(props!.variantProps.variant).toBe('detail');

      // Engine responds while command queue is still blocked
      await act(async () => {
        await state!.processIntent('engine rejects');
      });

      // Optimistic still active — engine response is queued behind the blocked command
      expect(props!.variantProps.variant).toBe('detail');

      // Advance past the 500ms waitForReady timeout to unblock the queue
      await act(async () => {
        await clock.tickAsync(600);
      });

      // Queue drained: engine response processed, optimistic cleared
      expect(props!.variantProps.variant).toBe('list');
    } finally {
      clock.uninstall();
    }
  });

  it('optimistic variant is rolled back when action runner returns Failure', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance({ variant: 'list' })]),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'orders'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('orders', 'inst-1');
      const runner = useMemo(
        () => ({
          viewDetail: () => Err(new Error('action failed')),
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props!.variantProps.variant).toBe('list');

    // executeAction sets optimistic to 'detail', but the runner returns Failure
    await act(async () => {
      props!.executeAction('viewDetail');
    });

    // Optimistic should be rolled back since the action failed
    expect(props!.variantProps.variant).toBe('list');
  });

  it('optimistic variant is rolled back when action runner throws', async () => {
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector({
      process: async () => makeResponse([makeInstance({ variant: 'list' })]),
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

    await act(async () => {
      await state!.processIntent('show orders');
    });

    expect(props!.variantProps.variant).toBe('list');

    // executeAction sets optimistic to 'detail', but the runner throws
    await act(async () => {
      props!.executeAction('viewDetail');
    });

    // Optimistic should be rolled back since the action threw
    expect(props!.variantProps.variant).toBe('list');
  });

  it('does not set optimistic variant when transitionsTo references a non-existent variant', async () => {
    // VesselSchema now rejects transitionsTo → non-existent variants at
    // registration time, so we construct a valid vessel (both variants present)
    // and then mutate the live object *after* registration to simulate state
    // drift at runtime. This still exercises the defensive branch in
    // useOptimisticVariant.applyTransition as belt-and-suspenders.
    const badVessel = defineVessel({
      id: 'bad-transitions',
      name: 'Bad Transitions',
      description: 'Vessel with invalid transitionsTo',
      defaultVariant: 'main',
      variants: {
        main: {
          props: { mode: 'main' as const },
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'goToGhost',
              description: 'Go to ghost',
              transitionsTo: 'ghost-variant',
            },
          ],
        },
        // Valid at registration so VesselSchema passes — deleted below to
        // simulate runtime drift before the action fires.
        'ghost-variant': {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [],
        },
      },
    });

    const badEntry = vessel(badVessel, () => null);
    const m = createMaelstrom({ vessels: [badEntry] });
    const connector = createMockConnector({
      process: async () => ({
        type: 'maelstrom_response' as const,
        requestId: 'req-1',
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: {
          type: 'tiling' as const,
          tree: [],
          instances: [
            {
              instanceId: 'inst-1',
              vesselId: 'bad-transitions',
              variant: 'main',
            },
          ],
        },
      }),
    });

    let state: { processIntent: (i: string) => Promise<void> } | undefined;
    let props: ReturnType<typeof m.useVessel<'bad-transitions'>> | undefined;

    function App() {
      state = m.useMaelstrom();
      props = m.useVessel('bad-transitions', 'inst-1');
      const runner = useMemo(
        () => ({ goToGhost: () => Success(undefined) }),
        [],
      );
      m.useActions('bad-transitions', 'inst-1', runner);
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
      await state!.processIntent('init');
    });

    expect(props!.variantProps.variant).toBe('main');

    // Simulate runtime drift: the action still points at 'ghost-variant',
    // but the target variant no longer exists on the live vessel object.
    delete (badVessel.variants as Record<string, unknown>)['ghost-variant'];

    // executeAction with transitionsTo pointing to a now-missing variant
    await act(async () => {
      props!.executeAction('goToGhost');
    });

    // Should NOT set optimistic to 'ghost-variant' (component would vanish)
    // Should stay on 'main'
    expect(props).not.toBeNull();
    expect(props!.variantProps.variant).toBe('main');
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
        requestId: 'req-1',
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: {
          type: 'tiling' as const,
          tree: [],
          instances: [
            {
              instanceId: 'inst-1',
              vesselId: 'toggle-panel',
              variant: 'expanded',
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

    await act(async () => {
      await state!.processIntent('show panel');
    });

    // Instance is on 'expanded' variant
    expect(props!.variantProps.variant).toBe('expanded');

    // 'toggle' on expanded should transition to 'collapsed', not 'expanded'
    await act(async () => {
      props!.executeAction('toggle');
    });

    expect(props!.variantProps.variant).toBe('collapsed');
  });
});
