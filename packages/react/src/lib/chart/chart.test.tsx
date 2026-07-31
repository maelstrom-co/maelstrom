import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import type {
  ChartRequestMessage,
  GridLayout,
  MaelstromResponse,
  TilingLayout,
} from '@maelstrom-co/protocol';
import { InstanceId, ok, VariantName, VesselId } from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { assertDefined } from '../__tests__/assert-defined.js';
import { createMockConnector } from '../__tests__/mock-connector.js';
import { testVessel } from '../__tests__/test-vessel.fixture.js';
import { createMaelstrom } from '../create-maelstrom.js';
import { vessel } from '../vessel.js';
import type { TypedVesselProps } from '../vessel-entry-types.js';
import {
  DEFAULT_MOTION,
  EXIT_CLEANUP_BUFFER_MS,
} from './motion/motion-config.js';

// Mock ResizeObserver (happy-dom may not implement it)
type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void;
let capturedObservers: Array<{
  callback: ResizeObserverCallback;
  element: Element;
}> = [];

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
      capturedObservers = capturedObservers.filter(
        (o) => o.callback !== this.#callback,
      );
    }
    unobserve() {}
  };
});

afterEach(() => {
  cleanup();
  capturedObservers = [];
});

/** Fire all captured ResizeObserver callbacks with the given dimensions */
function triggerResize(width: number, height: number) {
  const entry = {
    contentRect: {
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
    },
  } as ResizeObserverEntry;
  for (const observer of capturedObservers) {
    observer.callback([entry]);
  }
}

/**
 * Build a connector that creates an instance then positions it in grid layout.
 * First call: tiling layout to register instanceId/vesselId/variant.
 * Second call: grid layout to apply CSS grid positioning.
 * (Grid layout relies on existing instances for vesselId/variant.)
 */
function connectorWithGridInstance(
  instanceId: string,
  vesselId: string,
  variant: string,
) {
  let callCount = 0;
  return createMockConnector({
    process: async (msg: ChartRequestMessage): Promise<MaelstromResponse> => {
      callCount++;
      const brandedId = InstanceId(instanceId);
      if (callCount === 1) {
        return {
          type: 'maelstrom_response',
          requestId: msg.id,
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout: {
            type: 'tiling',
            tree: [brandedId],
            instances: [
              {
                instanceId: brandedId,
                vesselId: VesselId(vesselId),
                variant: VariantName(variant),
              },
            ],
          },
        };
      }
      return {
        type: 'maelstrom_response',
        requestId: msg.id,
        userMessage: '',
        rationale: '',
        executionPlan: [],
        layout: {
          type: 'grid',
          positions: [
            {
              instanceId: brandedId,
              position: { column: 2, row: 1 },
              size: { width: 3, height: 2 },
            },
          ],
        },
      };
    },
  });
}

/** Build a connector that responds with a tiling layout */
function connectorWithTilingLayout(
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
        instances: [
          {
            instanceId: brandedId,
            vesselId: VesselId(vesselId),
            variant: VariantName(variant),
          },
        ],
      },
    }),
  });
}

describe('m.Chart — render structure', () => {
  it('renders an empty container when no layout is active', async () => {
    const entry = vessel(testVessel, () => <div>hi</div>);
    const m = createMaelstrom({ vessels: [entry] });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={createMockConnector()}>
          <m.Chart />
        </m.Provider>,
      ));
    });

    // Container renders but no vessel instances
    expect(container.innerHTML).not.toContain('data-instance-id');
  });

  it('accepts className and style props', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={createMockConnector()}>
          <m.Chart className="my-chart" style={{ background: 'red' }} />
        </m.Provider>,
      ));
    });

    const chartEl = container.firstElementChild as HTMLElement;
    expect(chartEl.className).toBe('my-chart');
    expect(chartEl.style.background).toBe('red');
  });

  it('renders children inside the chart container', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={createMockConnector()}>
          <m.Chart>
            <div>slot content</div>
          </m.Chart>
        </m.Provider>,
      ));
    });

    expect(container.innerHTML).toContain('slot content');
  });
});

describe('m.Chart — ResizeObserver', () => {
  it('calls chartManager.setDimensions when container resizes', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = createMockConnector();

    const { container } = await act(async () =>
      render(
        <m.Provider connector={connector} cellSizePx={100}>
          <m.Chart />
        </m.Provider>,
      ),
    );

    // Simulate container resize: 800×600 px, cellSizePx=100 → 8 columns, 6 rows
    await act(async () => {
      triggerResize(800, 600);
    });

    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(8, 1fr)');
    expect(grid.style.gridTemplateRows).toBe('repeat(6, 1fr)');
  });

  it('floors fractional cell counts', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });

    const { container } = await act(async () =>
      render(
        <m.Provider connector={createMockConnector()} cellSizePx={80}>
          <m.Chart />
        </m.Provider>,
      ),
    );

    // 850px / 80 = 10.625 → floor → 10 columns
    await act(async () => {
      triggerResize(850, 650);
    });

    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe('repeat(10, 1fr)');
    expect(grid.style.gridTemplateRows).toBe('repeat(8, 1fr)');
  });
});

describe('m.Chart — grid layout', () => {
  it('renders vessel instance wrapper after engine places it in grid layout', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorWithGridInstance('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      ));
    });

    // First intent: tiling layout registers instance
    assertDefined(processIntent);
    const processTilingIntent = processIntent;
    await act(async () => {
      await processTilingIntent('show orders');
    });
    // Second intent: grid layout positions instance
    assertDefined(processIntent);
    const processGridIntent = processIntent;
    await act(async () => {
      await processGridIntent('layout as grid');
    });

    // The vessel instance wrapper should appear in the DOM
    expect(container.innerHTML).toContain('data-instance-id="inst-1"');
  });

  it('applies CSS grid positioning from GridLayout.positions', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry] });
    // position: column=2, row=1, size: width=3, height=2
    // → gridColumn: "3 / 6", gridRow: "2 / 4"
    const connector = connectorWithGridInstance('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      ));
    });

    // First intent: tiling layout registers instance
    assertDefined(processIntent);
    const processTilingIntent = processIntent;
    await act(async () => {
      await processTilingIntent('x');
    });
    // Second intent: grid layout positions instance
    assertDefined(processIntent);
    const processGridIntent = processIntent;
    await act(async () => {
      await processGridIntent('grid');
    });

    expect(container.innerHTML).toContain('data-instance-id="inst-1"');
    // column=2 → gridColumnStart=3, width=3 → gridColumnEnd=6
    expect(container.innerHTML).toContain('grid-column: 3 / 6');
    // row=1 → gridRowStart=2, height=2 → gridRowEnd=4
    expect(container.innerHTML).toContain('grid-row: 2 / 4');
  });
});

describe('m.Chart — tiling layout', () => {
  it('renders vessel instance with absolute positioning in tiling layout', async () => {
    const entry = vessel(testVessel, () => <div>tiling</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorWithTilingLayout('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      ));
    });

    // Set container dimensions so tiling layout has a rect to work with
    await act(async () => {
      triggerResize(800, 600);
    });

    assertDefined(processIntent);
    const processIntentSnapshot = processIntent;
    await act(async () => {
      await processIntentSnapshot('x');
    });

    expect(container.innerHTML).toContain('data-instance-id="inst-1"');
    expect(container.innerHTML).toContain('position: absolute');
  });
});

describe('m.Chart — executeAction routing (regression)', () => {
  // Injected actions must forward the exact params object through to the
  // registered runner.
  it('delivers executeAction params through to the registered runner', async () => {
    const selectOrder = mock((_params: { orderId: string }) => ok(undefined));

    let capturedExecuteAction:
      | TypedVesselProps<typeof testVessel>['executeAction']
      | undefined;
    function CapturingVessel(props: TypedVesselProps<typeof testVessel>) {
      capturedExecuteAction = props.executeAction;
      return <div>captured</div>;
    }

    const entry = vessel(testVessel, CapturingVessel);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorWithTilingLayout('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      m.useActions('orders', 'inst-1', { selectOrder });
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      triggerResize(800, 600);
    });
    assertDefined(processIntent);
    const runIntent = processIntent;
    await act(async () => {
      await runIntent('show orders');
    });

    // Chart has rendered the vessel, exposing its injected executeAction
    assertDefined(capturedExecuteAction);
    const executeAction = capturedExecuteAction;

    await act(async () => {
      executeAction('selectOrder', { orderId: 'order-42' });
    });

    expect(selectOrder).toHaveBeenCalledTimes(1);
    expect(selectOrder).toHaveBeenCalledWith({ orderId: 'order-42' });
  });
});

describe('m.Chart — debug overlay', () => {
  it('shows grid debug overlay when debug=true', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry], debug: true });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={createMockConnector()}>
          <m.Chart />
        </m.Provider>,
      ));
    });

    // Debug overlay is rendered when debug config is true
    expect(container.innerHTML).toContain('data-chart-debug');
  });

  it('does not show debug overlay when debug=false', async () => {
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry], debug: false });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={createMockConnector()}>
          <m.Chart />
        </m.Provider>,
      ));
    });

    expect(container.innerHTML).not.toContain('data-chart-debug');
  });
});

describe('m.Chart — unknown variant warning (fix: must not be debug-gated)', () => {
  it('warns even when debug is false, since a debug-gated warning is invisible in production', async () => {
    // Fix 5: an instance whose variant the vessel no longer declares (e.g.
    // after m.updateVessel drops a live variant) renders as a silently
    // blank tile — chart.tsx returns null either way. Before this fix the
    // only signal was a `console.warn` gated behind `config.debug`, so a
    // production app (debug: false, the default) got no signal at all.
    const entry = vessel(testVessel, () => null);
    const m = createMaelstrom({ vessels: [entry], debug: false });
    const connector = connectorWithTilingLayout(
      'i-1',
      'orders',
      'ghost-variant',
    );

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await act(async () => {
        render(
          <m.Provider connector={connector}>
            <m.Chart />
            <Reader />
          </m.Provider>,
        );
      });

      await act(async () => {
        triggerResize(800, 600);
      });

      assertDefined(processIntent);
      const submit = processIntent;
      await act(async () => {
        await submit('x');
      });

      const warned = warnSpy.mock.calls.some((args) =>
        args.some(
          (a) =>
            typeof a === 'string' &&
            a.includes('Unknown variant') &&
            a.includes('ghost-variant'),
        ),
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('m.Chart — lazy vessel retry', () => {
  it('retries a failed lazy import by busting the React.lazy cache', async () => {
    let loadAttempt = 0;
    const loader = () => {
      loadAttempt++;
      if (loadAttempt === 1) {
        return Promise.reject(new Error('network error'));
      }
      return Promise.resolve({
        default: () => <div data-testid="lazy-content">loaded</div>,
      });
    };

    const entry = vessel(testVessel, loader, () => <div>loading...</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorWithTilingLayout('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      ));
    });

    await act(async () => {
      triggerResize(800, 600);
    });
    assertDefined(processIntent);
    const processIntentSnapshot = processIntent;
    await act(async () => {
      await processIntentSnapshot('show orders');
    });

    // First load attempt failed — error UI should appear
    expect(container.innerHTML).toContain('data-vessel-error="orders"');
    expect(loadAttempt).toBe(1);

    // Click retry button
    const retryButton = container.getElementsByTagName('button')[0];
    assertDefined(retryButton);
    await act(async () => {
      fireEvent.click(retryButton);
    });

    // Second load attempt should succeed
    expect(loadAttempt).toBe(2);
    expect(container.innerHTML).toContain('loaded');
    expect(container.innerHTML).not.toContain('data-vessel-error');
  });

  // Regression: dynamic-register × retry is where the original bug hid — lazy
  // lookup routed through vesselEntries, which dynamic registration never
  // touched, so a registerVessel'd lazy vessel failed silently. After the
  // fix, retry also works on dynamic entries.
  it('retries a failed lazy import on a dynamically-registered lazy vessel', async () => {
    let loadAttempt = 0;
    const loader = () => {
      loadAttempt++;
      if (loadAttempt === 1) {
        return Promise.reject(new Error('network error'));
      }
      return Promise.resolve({
        default: () => <div data-testid="lazy-content">dynamic loaded</div>,
      });
    };

    const dynamicLazyEntry = vessel(testVessel, loader, () => (
      <div>loading...</div>
    ));

    // Note: createMaelstrom is called with an empty vessel list — the entry
    // is added dynamically via registerVessel after mount.
    const m = createMaelstrom({ vessels: [] });
    const connector = connectorWithTilingLayout('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function App() {
      processIntent = m.useMaelstrom().processIntent;
      useEffect(() => {
        m.registerVessel(dynamicLazyEntry);
      }, []);
      return null;
    }

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <App />
        </m.Provider>,
      ));
    });

    await act(async () => {
      triggerResize(800, 600);
    });
    assertDefined(processIntent);
    const processIntentSnapshot = processIntent;
    await act(async () => {
      await processIntentSnapshot('show orders');
    });

    // First load attempt failed — error UI should appear (proves the dynamic
    // entry was actually wired into lazyLoaderRegistry; otherwise the chart
    // would render null with no error boundary trigger).
    expect(container.innerHTML).toContain('data-vessel-error="orders"');
    expect(loadAttempt).toBe(1);

    const retryButton = container.getElementsByTagName('button')[0];
    assertDefined(retryButton);
    await act(async () => {
      fireEvent.click(retryButton);
    });

    expect(loadAttempt).toBe(2);
    expect(container.innerHTML).toContain('dynamic loaded');
    expect(container.innerHTML).not.toContain('data-vessel-error');
  });
});

describe('m.Chart — duplicate chart guard', () => {
  it('renders error message when two Charts are mounted under the same Provider', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={createMockConnector()}>
          <m.Chart />
          <m.Chart />
        </m.Provider>,
      ));
    });

    // One Chart renders normally, the other shows the duplicate error
    expect(container.innerHTML).toContain('Only one');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Only one <Chart>'),
    );
    warnSpy.mockRestore();
  });

  it('allows a single Chart to render without duplicate error', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={createMockConnector()}>
          <m.Chart />
        </m.Provider>,
      ));
    });

    expect(container.innerHTML).not.toContain('Only one');
  });
});

describe('m.Chart — motion', () => {
  interface AnimateCall {
    id: string | null;
    // Exit ghosts render from the same VesselRenderer as live instances (see
    // MAE-343 follow-up: single render-entry array, not a separately-wrapped
    // ExitingVessel), so they carry the same `data-instance-id` a live
    // instance would. `data-exiting` is the only DOM signal that distinguishes
    // an exit-shaped animate() call from a live FLIP/enter call on the same id.
    exiting: boolean;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
  }

  let animateCalls: AnimateCall[] = [];

  beforeEach(() => {
    animateCalls = [];

    // Stub WAAPI: happy-dom doesn't implement Element.animate. Attached via
    // `window.Element` (not the bare global) because setup.ts rebuilds
    // `window` per test and doesn't splice it onto the Node global scope.
    window.Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      animateCalls.push({
        id: this.getAttribute('data-instance-id'),
        exiting: this.hasAttribute('data-exiting'),
        keyframes: keyframes as Keyframe[],
        options: options as KeyframeAnimationOptions,
      });
      return {
        cancel() {},
        finished: Promise.resolve(),
      } as unknown as Animation;
    } as never;

    // Stub getBoundingClientRect: happy-dom has no layout engine, so every
    // element reports a zero rect. Deriving a synthetic rect from the grid
    // wrapper's own `gridColumn`/`gridRow` inline style (which chart.tsx sets
    // per layout) gives FLIP a real position delta to detect when a vessel's
    // grid placement changes, and an unchanged rect when it doesn't.
    window.Element.prototype.getBoundingClientRect = function (this: Element) {
      const style = (this as HTMLElement).style;
      const rect = this.hasAttribute('data-instance-id')
        ? gridCellRect(style.gridColumn, style.gridRow)
        : null;
      const r = rect ?? { x: 0, y: 0, width: 0, height: 0 };
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.y,
        left: r.x,
        right: r.x + r.width,
        bottom: r.y + r.height,
        toJSON() {
          return {};
        },
      } as DOMRect;
    } as never;
  });

  const CELL = 100;

  function gridCellRect(
    gridColumn: string,
    gridRow: string,
  ): { x: number; y: number; width: number; height: number } | null {
    if (!gridColumn || !gridRow) return null;
    const [colStart, colEnd] = gridColumn
      .split('/')
      .map((s) => parseInt(s.trim(), 10));
    const [rowStart, rowEnd] = gridRow
      .split('/')
      .map((s) => parseInt(s.trim(), 10));
    if ([colStart, colEnd, rowStart, rowEnd].some(Number.isNaN)) {
      return null;
    }
    return {
      x: (colStart - 1) * CELL,
      y: (rowStart - 1) * CELL,
      width: (colEnd - colStart) * CELL,
      height: (rowEnd - rowStart) * CELL,
    };
  }

  // Recursive children-walk instead of an attribute-selector querySelector,
  // which throws under this repo's bun+happy-dom combo.
  function findByInstanceId(root: Element, id: string): HTMLElement | null {
    for (const child of Array.from(root.children)) {
      if (child.getAttribute('data-instance-id') === id)
        return child as HTMLElement;
      const nested = findByInstanceId(child, id);
      if (nested) return nested;
    }
    return null;
  }

  function registerLayout(ids: string[]): TilingLayout {
    return {
      type: 'tiling',
      tree: [],
      instances: ids.map((id) => ({
        instanceId: InstanceId(id),
        vesselId: VesselId('orders'),
        variant: VariantName('list'),
      })),
    };
  }

  function gridLayout(
    entries: Array<{
      id: string;
      column: number;
      row: number;
      width?: number;
      height?: number;
    }>,
  ): GridLayout {
    return {
      type: 'grid',
      positions: entries.map((e) => ({
        instanceId: InstanceId(e.id),
        position: { column: e.column, row: e.row },
        size: { width: e.width ?? 1, height: e.height ?? 1 },
      })),
    };
  }

  function connectorSeq(layouts: Array<GridLayout | TilingLayout>) {
    let i = 0;
    return createMockConnector({
      process: async (msg: ChartRequestMessage): Promise<MaelstromResponse> => {
        const layout = layouts[Math.min(i, layouts.length - 1)]!;
        i++;
        return {
          type: 'maelstrom_response',
          requestId: msg.id,
          userMessage: '',
          rationale: '',
          executionPlan: [],
          layout,
        };
      },
    });
  }

  it('(a) layout change triggers FLIP animate calls on moved instance wrappers', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorSeq([
      registerLayout(['a', 'b']),
      gridLayout([
        { id: 'a', column: 0, row: 0, width: 2, height: 2 },
        { id: 'b', column: 10, row: 0, width: 2, height: 2 },
      ]),
      gridLayout([
        { id: 'a', column: 14, row: 0, width: 2, height: 2 },
        { id: 'b', column: 10, row: 0, width: 2, height: 2 },
      ]),
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      await processIntent!('register');
    });
    await act(async () => {
      await processIntent!('layout1');
    });

    animateCalls = [];
    await act(async () => {
      await processIntent!('layout2');
    });

    const aCalls = animateCalls.filter((c) => c.id === 'a');
    const bCalls = animateCalls.filter((c) => c.id === 'b');
    expect(aCalls.length).toBe(1);
    expect(bCalls.length).toBe(0);
    expect(aCalls[0]!.keyframes[0]!.transform).toContain('translate');
  });

  // Ordering guard for the exit-snapshot invariant: useExitingInstances must
  // measure BEFORE useChartMotion starts any WAAPI animation, because a
  // freshly-created animation applies its first (inverted, old-position)
  // keyframe to computed style immediately — a snapshot taken after that
  // captures a pre-move rect. happy-dom has no layout engine, so a faithful
  // "ghost placed at stale position" test can't fail here; instead this
  // instruments both hooks' shared primitives and asserts that within the
  // commit no instance measurement happens after an animation has started.
  it('takes all exit-snapshot measurements before any animation starts in the same commit', async () => {
    const events: string[] = [];
    const baseRect = window.Element.prototype.getBoundingClientRect;
    const baseAnimate = window.Element.prototype.animate;
    window.Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.hasAttribute('data-instance-id'))
        events.push(`measure:${this.getAttribute('data-instance-id')}`);
      return baseRect.call(this);
    } as never;
    window.Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      events.push(`animate:${this.getAttribute('data-instance-id')}`);
      return baseAnimate.call(this, keyframes as Keyframe[], options);
    } as never;

    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorSeq([
      registerLayout(['a', 'b']),
      gridLayout([
        { id: 'a', column: 0, row: 0, width: 2, height: 2 },
        { id: 'b', column: 8, row: 0, width: 2, height: 2 },
      ]),
      // 'a' moves (FLIPs) and 'b' is removed (needs an exit snapshot).
      gridLayout([{ id: 'a', column: 14, row: 0, width: 2, height: 2 }]),
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      await processIntent!('register');
    });
    await act(async () => {
      await processIntent!('layout1');
    });

    events.length = 0;
    await act(async () => {
      await processIntent!('layout2');
    });

    const firstAnimate = events.findIndex((e) => e.startsWith('animate'));
    expect(firstAnimate).toBeGreaterThan(-1);
    const measuresAfterAnimate = events
      .slice(firstAnimate)
      .filter((e) => e.startsWith('measure'));
    expect(measuresAfterAnimate).toEqual([]);
  });

  // happy-dom has no layout engine, so the rig's shared getBoundingClientRect
  // stub (gridCellRect) derives fake rects from grid line numbers times a
  // CONSTANT cell size, which can't express "same grid position, different
  // pixel rect because the track count changed" -- the real-world trigger for
  // this bug. This test installs its own cellSizePx-aware rect stub (mirroring
  // what a real browser's grid layout would produce) so the stale-vs-fresh
  // FLIP baseline is directly observable in the animate() keyframes.
  it('(FIX 3) a cellSizePx change that alters the track count re-baselines rects with no container resize', async () => {
    let trackCellPx = 100;
    const baseRect = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function (this: Element) {
      const style = (this as HTMLElement).style;
      const rect = this.hasAttribute('data-instance-id')
        ? (() => {
            const [colStart, colEnd] = style.gridColumn
              .split('/')
              .map((s) => parseInt(s.trim(), 10));
            const [rowStart, rowEnd] = style.gridRow
              .split('/')
              .map((s) => parseInt(s.trim(), 10));
            if (
              colStart === undefined ||
              colEnd === undefined ||
              rowStart === undefined ||
              rowEnd === undefined
            ) {
              return null;
            }
            return {
              x: (colStart - 1) * trackCellPx,
              y: (rowStart - 1) * trackCellPx,
              width: (colEnd - colStart) * trackCellPx,
              height: (rowEnd - rowStart) * trackCellPx,
            };
          })()
        : null;
      const r = rect ?? { x: 0, y: 0, width: 0, height: 0 };
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        top: r.y,
        left: r.x,
        right: r.x + r.width,
        bottom: r.y + r.height,
        toJSON() {
          return {};
        },
      } as DOMRect;
    } as never;

    try {
      const entry = vessel(testVessel, () => <div>content</div>);
      const m = createMaelstrom({ vessels: [entry] });
      const connector = connectorSeq([
        registerLayout(['a']),
        gridLayout([{ id: 'a', column: 0, row: 0, width: 2, height: 2 }]),
        gridLayout([{ id: 'a', column: 4, row: 0, width: 2, height: 2 }]),
      ]);

      let processIntent: ((intent: string) => Promise<void>) | undefined;
      function Reader() {
        processIntent = m.useMaelstrom().processIntent;
        return null;
      }

      let rerender!: (ui: React.ReactElement) => void;
      await act(async () => {
        ({ rerender } = render(
          <m.Provider connector={connector} cellSizePx={100}>
            <m.Chart />
            <Reader />
          </m.Provider>,
        ));
      });

      await act(async () => {
        await processIntent!('register');
      });
      await act(async () => {
        await processIntent!('layout1');
      });
      // 800x600 @ cellSizePx=100 -> 8 columns; 'a' baselines at width=200 (2 cells * 100px).
      await act(async () => {
        triggerResize(800, 600);
      });

      // Same container pixels, but cellSizePx doubles -> 4 columns, so each
      // 1fr track (and thus 'a's real pixel width) doubles too, though the
      // grid POSITION (layoutKey) is untouched.
      trackCellPx = 200;
      await act(async () => {
        rerender(
          <m.Provider connector={connector} cellSizePx={200}>
            <m.Chart />
            <Reader />
          </m.Provider>,
        );
      });
      await act(async () => {
        triggerResize(800, 600);
      });

      animateCalls = [];
      await act(async () => {
        await processIntent!('layout2');
      });

      const aCalls = animateCalls.filter((c) => c.id === 'a');
      expect(aCalls).toHaveLength(1);
      // Fresh baseline (post-fix): prev width === next width (both at
      // trackCellPx=200), so the FLIP is a pure translate with no scale.
      // Stale baseline (pre-fix, bug): prev width is still the pre-resize
      // 200px against a next width of 400px, producing a spurious scale(0.5).
      expect(aCalls[0]!.keyframes[0]!.transform).toContain('scale(1, 1)');
      expect(aCalls[0]!.keyframes[0]!.transform).not.toContain('scale(0.5');
    } finally {
      window.Element.prototype.getBoundingClientRect = baseRect;
    }
  });

  it('(b) new instance triggers enter keyframes', async () => {
    // Tiling mode: `instances` always lists both ids (so 'b' is a known
    // instance the whole time) while `tree` controls what actually renders.
    // Grid mode can't express "add an instance back later" here — a
    // GridLayout entirely replaces the instances map from its own
    // `positions`, so an id dropped from one response can never reappear in
    // a later one without a fresh tiling registration.
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const instances = [
      {
        instanceId: InstanceId('a'),
        vesselId: VesselId('orders'),
        variant: VariantName('list'),
      },
      {
        instanceId: InstanceId('b'),
        vesselId: VesselId('orders'),
        variant: VariantName('list'),
      },
    ];
    const connector = connectorSeq([
      { type: 'tiling', tree: [InstanceId('a')], instances },
      {
        type: 'tiling',
        tree: ['V', InstanceId('a'), InstanceId('b')],
        instances,
      },
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      await processIntent!('layout1');
    });

    animateCalls = [];
    await act(async () => {
      await processIntent!('layout2');
    });

    const aCalls = animateCalls.filter((c) => c.id === 'a');
    const bCalls = animateCalls.filter((c) => c.id === 'b');
    expect(aCalls.length).toBe(0);
    expect(bCalls.length).toBe(1);
    expect(bCalls[0]!.keyframes[0]).toEqual({
      opacity: 0,
      transform: 'scale(0.96)',
    });
  });

  it('(c) a removed instance keeps an exit node in the DOM and it disappears after the motion duration', async () => {
    const clock = FakeTimers.install();
    try {
      const entry = vessel(testVessel, () => <div>content</div>);
      const m = createMaelstrom({ vessels: [entry] });
      const connector = connectorSeq([
        registerLayout(['a', 'b']),
        gridLayout([
          { id: 'a', column: 0, row: 0, width: 2, height: 2 },
          { id: 'b', column: 8, row: 0, width: 2, height: 2 },
        ]),
        gridLayout([{ id: 'a', column: 0, row: 0, width: 2, height: 2 }]),
      ]);

      let processIntent: ((intent: string) => Promise<void>) | undefined;
      function Reader() {
        processIntent = m.useMaelstrom().processIntent;
        return null;
      }

      let container: HTMLElement;
      await act(async () => {
        ({ container } = render(
          <m.Provider connector={connector}>
            <m.Chart />
            <Reader />
          </m.Provider>,
        ));
      });

      await act(async () => {
        await processIntent!('register');
      });
      await act(async () => {
        await processIntent!('layout1');
      });
      await act(async () => {
        await processIntent!('layout2');
      });

      // Exit node persists immediately after removal.
      expect(container!.innerHTML).toContain('data-instance-id="b"');

      // Just shy of the durationMs + buffer: still present.
      await act(async () => {
        clock.tick(DEFAULT_MOTION.durationMs + EXIT_CLEANUP_BUFFER_MS - 1);
      });
      expect(container!.innerHTML).toContain('data-instance-id="b"');

      await act(async () => {
        clock.tick(1);
      });
      expect(container!.innerHTML).not.toContain('data-instance-id="b"');
    } finally {
      clock.uninstall();
    }
  });

  it('does not remount the vessel component when it becomes an exit ghost', async () => {
    // Regression: live instances and exit ghosts used to render from two
    // separate .map() child slots with different keys (`id` vs `exit-${id}`),
    // so React couldn't reconcile across the live -> exiting transition and
    // unmounted the real component, mounting a brand-new one for the fade.
    // Any local state, in-flight effects, or subscriptions on the vessel are
    // lost when that happens — this proves the underlying component instance
    // survives the transition.
    let mountCount = 0;
    function MountCounter() {
      useEffect(() => {
        mountCount++;
      }, []);
      return <div>content</div>;
    }
    const entry = vessel(testVessel, MountCounter);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorSeq([
      registerLayout(['a']),
      gridLayout([{ id: 'a', column: 0, row: 0, width: 2, height: 2 }]),
      gridLayout([]),
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      await processIntent!('register');
    });
    await act(async () => {
      await processIntent!('layout1');
    });

    expect(mountCount).toBe(1);

    // Removing 'a' from the layout turns it into an exit ghost.
    await act(async () => {
      await processIntent!('layout2');
    });

    expect(mountCount).toBe(1);
  });

  it('exit animation holds its end state with fill: "forwards"', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorSeq([
      registerLayout(['a', 'b']),
      gridLayout([
        { id: 'a', column: 0, row: 0, width: 2, height: 2 },
        { id: 'b', column: 8, row: 0, width: 2, height: 2 },
      ]),
      gridLayout([{ id: 'a', column: 0, row: 0, width: 2, height: 2 }]),
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      await processIntent!('register');
    });
    await act(async () => {
      await processIntent!('layout1');
    });

    animateCalls = [];
    await act(async () => {
      await processIntent!('layout2');
    });

    const exitShapedCalls = animateCalls.filter((c) => c.exiting);
    expect(exitShapedCalls.length).toBe(1);
    expect(exitShapedCalls[0]!.id).toBe('b');
    expect(exitShapedCalls[0]!.options.fill).toBe('forwards');
  });

  it('exit animation does not re-fire on an unrelated layout update', async () => {
    // Regression: the exit-ghost effect used to run on every Chart re-render
    // (or via an inline callback ref before that). Since `config.motion` is a
    // fresh object every render, a naive dependency on it — or no dependency
    // array discipline at all — would re-invoke `element.animate()` on the
    // already-mounted node, visually restarting the fade mid-flight even
    // though nothing about the exiting instance changed.
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorSeq([
      registerLayout(['a', 'b']),
      gridLayout([
        { id: 'a', column: 0, row: 0, width: 2, height: 2 },
        { id: 'b', column: 8, row: 0, width: 2, height: 2 },
      ]),
      gridLayout([{ id: 'a', column: 0, row: 0, width: 2, height: 2 }]),
      gridLayout([{ id: 'a', column: 14, row: 0, width: 2, height: 2 }]),
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      await processIntent!('register');
    });
    await act(async () => {
      await processIntent!('layout1');
    });
    // Removing 'b' starts its exit animation.
    await act(async () => {
      await processIntent!('removeB');
    });

    animateCalls = [];
    // Unrelated layout update: 'a' moves, 'b' stays removed/exiting.
    await act(async () => {
      await processIntent!('moveA');
    });

    const exitShapedCalls = animateCalls.filter((c) => c.exiting);
    expect(exitShapedCalls.length).toBe(0);
  });

  it('(d) motion: { disabled: true } produces zero animate calls and instant removal', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorSeq([
      registerLayout(['a', 'b']),
      gridLayout([
        { id: 'a', column: 0, row: 0, width: 2, height: 2 },
        { id: 'b', column: 8, row: 0, width: 2, height: 2 },
      ]),
      gridLayout([{ id: 'a', column: 14, row: 0, width: 2, height: 2 }]),
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector} motion={{ disabled: true }}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      ));
    });

    await act(async () => {
      await processIntent!('register');
    });
    await act(async () => {
      await processIntent!('layout1');
    });

    animateCalls = [];
    await act(async () => {
      await processIntent!('layout2');
    });

    // 'a' moved and 'b' was removed — with motion disabled neither animates,
    // and the removed instance leaves no lingering exit node.
    expect(animateCalls.length).toBe(0);
    expect(container!.innerHTML).not.toContain('data-instance-id="b"');
  });

  it('createMaelstrom({ motion: { disabled: true } }) reaches the Chart with zero animate calls', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry], motion: { disabled: true } });
    const connector = connectorSeq([
      registerLayout(['a']),
      gridLayout([{ id: 'a', column: 0, row: 0, width: 2, height: 2 }]),
      gridLayout([{ id: 'a', column: 10, row: 0, width: 2, height: 2 }]),
    ]);

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    await act(async () => {
      render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      );
    });

    await act(async () => {
      await processIntent!('register');
    });
    await act(async () => {
      await processIntent!('layout1');
    });

    animateCalls = [];
    await act(async () => {
      await processIntent!('layout2');
    });

    expect(animateCalls.length).toBe(0);
  });

  it('(e) vessel inline styles no longer contain a transition property in grid mode', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorWithGridInstance('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      ));
    });

    await act(async () => {
      await processIntent!('x');
    });
    await act(async () => {
      await processIntent!('grid');
    });

    const grid = container!.firstElementChild as HTMLElement;
    const wrapper = findByInstanceId(grid, 'inst-1')!;
    expect(wrapper.style.transition).toBe('');
  });

  it('(e) vessel inline styles no longer contain a transition property in tiling mode', async () => {
    const entry = vessel(testVessel, () => <div>content</div>);
    const m = createMaelstrom({ vessels: [entry] });
    const connector = connectorWithTilingLayout('inst-1', 'orders', 'list');

    let processIntent: ((intent: string) => Promise<void>) | undefined;
    function Reader() {
      processIntent = m.useMaelstrom().processIntent;
      return null;
    }

    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <m.Provider connector={connector}>
          <m.Chart />
          <Reader />
        </m.Provider>,
      ));
    });

    await act(async () => {
      triggerResize(800, 600);
    });
    await act(async () => {
      await processIntent!('x');
    });

    const tiling = container!.firstElementChild as HTMLElement;
    const wrapper = findByInstanceId(tiling, 'inst-1')!;
    expect(wrapper.style.transition).toBe('');
  });
});
