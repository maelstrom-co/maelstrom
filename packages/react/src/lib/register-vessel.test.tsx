import { StrictMode, useEffect, useState, useMemo } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import type { VesselInstance } from '@maelstrom-co/client';
import type { ActionRunner } from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
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
import { resetWarnings } from './warn-once.js';

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

// These tests exercise the Chart, so they need a ResizeObserver mock. They
// share the bug-fix surface that registerVessel/unregister must keep
// lazyLoaderRegistry in sync with componentRegistry on the dynamic path.

type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void;
let capturedObservers: Array<{ callback: ResizeObserverCallback; element: Element }> = [];

beforeAll(() => {
  // @ts-expect-error
  globalThis.ResizeObserver = class MockResizeObserver {
    #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe(element: Element) {
      capturedObservers.push({ callback: this.#callback, element });
    }
    disconnect() {
      capturedObservers = capturedObservers.filter((o) => o.callback !== this.#callback);
    }
    unobserve() {}
  };
});

afterEach(() => {
  capturedObservers = [];
});

function triggerResize(width: number, height: number) {
  const entry = {
    contentRect: { width, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: width },
  } as ResizeObserverEntry;
  for (const observer of capturedObservers) {
    observer.callback([entry]);
  }
}

/**
 * Build a connector that issues a tiling layout containing the given
 * vesselId/variant on every request — handy for forcing the chart to
 * try to render a freshly-registered dynamic vessel.
 */
function connectorWithTilingInstance(
  instanceId: string,
  vesselId: string,
  variant: string,
) {
  const brandedId = InstanceId(instanceId);
  return createMockConnector({
    process: async (msg: ChartRequestMessage): Promise<MaelstromResponse> => ({
      type: 'maelstrom_response',
      requestId: msg.id,
      userMessage: '',
      rationale: '',
      executionPlan: [],
      layout: {
        type: 'tiling',
        tree: [brandedId],
        instances: [{ instanceId: brandedId, vesselId, variant }],
      },
    }),
  });
}

describe('m.registerVessel() — lazy loader registry', () => {
  let warnSpy: ReturnType<typeof spyOn>;

  // Spy at the describe scope and restore in afterAll — inline restoration
  // would be skipped on assertion failure and the mocked impl would leak.
  beforeAll(() => {
    warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockClear();
    resetWarnings();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('chart renders a dynamically-registered lazy vessel without "No component registered" warning', async () => {
    const lazyEntry = vessel(
      widgetVessel,
      async () => ({
        default: () => <div data-testid="dyn-lazy">dynamic lazy content</div>,
      }),
      () => <div>loading…</div>,
    );

    const m = createMaelstrom({ vessels: [orderEntry], debug: true });
    const connector = connectorWithTilingInstance('widget-1', 'widget', 'default');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      useEffect(() => {
        m.registerVessel(lazyEntry);
      }, []);
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <App />
        </m.Provider>,
      ));
    });

    await act(async () => { triggerResize(800, 600); });
    await act(async () => { await processIntent!('show widget'); });

    expect(container!.innerHTML).toContain('dynamic lazy content');
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('No component registered for vessel "widget"'),
    );
  });

  it('unregister clears lazyLoaderRegistry and the no-component warning fires for genuinely-absent vessels', async () => {
    const lazyEntry = vessel(
      widgetVessel,
      async () => ({
        default: () => <div data-testid="dyn-lazy">dynamic lazy content</div>,
      }),
      () => <div>loading…</div>,
    );

    const m = createMaelstrom({ vessels: [orderEntry], debug: true });
    const connector = connectorWithTilingInstance('widget-1', 'widget', 'default');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    let handle: { unregister: () => void } | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      handle = useMemo(() => m.registerVessel(lazyEntry), []);
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <App />
        </m.Provider>,
      ));
    });

    await act(async () => { triggerResize(800, 600); });
    await act(async () => { await processIntent!('show widget'); });

    // Sanity: lazy vessel rendered first time round.
    expect(container!.innerHTML).toContain('dynamic lazy content');
    warnSpy.mockClear();

    // Unregister, then trigger a re-render via another processIntent.
    await act(async () => { handle!.unregister(); });
    await act(async () => { await processIntent!('show widget again'); });

    // After unregister: nothing renders for that vessel id, and the negative
    // warning fires — confirms lazyLoaderRegistry.delete cleared the entry
    // (and that the existing diagnostic still works for genuinely-absent vessels).
    expect(container!.innerHTML).not.toContain('dynamic lazy content');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No component registered for vessel "widget"'),
    );
  });

  it('re-registering with a different loader: second loader wins in lazyLoaderRegistry', async () => {
    const firstEntry = vessel(
      widgetVessel,
      async () => ({
        default: () => <div data-testid="first">first content</div>,
      }),
      () => <div>loading…</div>,
    );
    const secondEntry = vessel(
      widgetVessel,
      async () => ({
        default: () => <div data-testid="second">second content</div>,
      }),
      () => <div>loading…</div>,
    );

    const m = createMaelstrom({ vessels: [orderEntry], debug: true });
    const connector = connectorWithTilingInstance('widget-1', 'widget', 'default');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      useEffect(() => {
        m.registerVessel(firstEntry);
        m.registerVessel(secondEntry);
      }, []);
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <App />
        </m.Provider>,
      ));
    });

    await act(async () => { triggerResize(800, 600); });
    await act(async () => { await processIntent!('show widget'); });

    // Second loader wins — chart shows its content, not the first one's.
    expect(container!.innerHTML).toContain('second content');
    expect(container!.innerHTML).not.toContain('first content');
  });

  it('dynamic eager register: chart renders eagerly with no Suspense fallback, even if the id was previously lazy', async () => {
    // Loader that never resolves — if the chart still routes through the lazy
    // path after the eager re-register, the loading skeleton would stick
    // forever and the eager content would never appear.
    const neverResolves: () => Promise<{ default: any }> = () => new Promise(() => {});
    const stuckLazyEntry = vessel(
      widgetVessel,
      neverResolves,
      () => <div data-testid="stuck-loading">stuck loading</div>,
    );
    const eagerEntry = vessel(widgetVessel, () => (
      <div data-testid="dyn-eager">eager dynamic content</div>
    ));

    const m = createMaelstrom({ vessels: [orderEntry], debug: true });
    const connector = connectorWithTilingInstance('widget-1', 'widget', 'default');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      useEffect(() => {
        // Register lazy first, then swap to eager — the eager path must clear
        // lazyVesselIds + lazyLoaderRegistry so the chart no longer routes
        // through Suspense/lazy lookup.
        m.registerVessel(stuckLazyEntry);
        m.registerVessel(eagerEntry);
      }, []);
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <App />
        </m.Provider>,
      ));
    });

    await act(async () => { triggerResize(800, 600); });
    await act(async () => { await processIntent!('show widget'); });

    // Eager component renders directly — proves lazyVesselIds was cleared.
    expect(container!.innerHTML).toContain('eager dynamic content');
    // Loading skeleton from the previous lazy entry must not appear —
    // proves the chart did not route through the stale lazy loader.
    expect(container!.innerHTML).not.toContain('stuck loading');
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('No component registered for vessel "widget"'),
    );
  });

  it('StrictMode double-invocation: second register overwrites benignly and chart still renders', async () => {
    // StrictMode double-fires useEffect, so registerVessel runs twice and the
    // second call hits the "already registered. Overwriting." warn path. The
    // chart must still render — the second-load wins, no error thrown.
    const lazyEntry = vessel(
      widgetVessel,
      async () => ({
        default: () => <div data-testid="dyn-lazy">dynamic lazy content</div>,
      }),
      () => <div>loading…</div>,
    );

    const m = createMaelstrom({ vessels: [orderEntry], debug: true });
    const connector = connectorWithTilingInstance('widget-1', 'widget', 'default');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      useEffect(() => {
        m.registerVessel(lazyEntry);
      }, []);
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <StrictMode>
          <m.Provider connector={connector}>
            <m.Chart />
            <App />
          </m.Provider>
        </StrictMode>,
      ));
    });

    await act(async () => { triggerResize(800, 600); });
    await act(async () => { await processIntent!('show widget'); });

    expect(container!.innerHTML).toContain('dynamic lazy content');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('vessel "widget" is already registered. Overwriting.'),
    );
  });
});
