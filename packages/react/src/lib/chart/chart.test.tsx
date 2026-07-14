import { useEffect } from 'react';
import { describe, it, expect, afterEach, beforeAll, spyOn, mock } from 'bun:test';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import type {
  ChartRequestMessage,
  MaelstromResponse,
} from '@maelstrom-co/protocol';
import { InstanceId, VesselId, VariantName, ok } from '@maelstrom-co/protocol';

import { createMaelstrom } from '../create-maelstrom.js';
import { vessel } from '../vessel.js';
import { testVessel } from '../__tests__/test-vessel.fixture.js';
import { createMockConnector } from '../__tests__/mock-connector.js';
import { assertDefined } from '../__tests__/assert-defined.js';
import type { TypedVesselProps } from '../vessel-entry-types.js';

// Mock ResizeObserver (happy-dom may not implement it)
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
  cleanup();
  capturedObservers = [];
});

/** Fire all captured ResizeObserver callbacks with the given dimensions */
function triggerResize(width: number, height: number) {
  const entry = {
    contentRect: { width, height, x: 0, y: 0, top: 0, left: 0, bottom: height, right: width },
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
function connectorWithGridInstance(instanceId: string, vesselId: string, variant: string) {
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
            instances: [{ instanceId: brandedId, vesselId: VesselId(vesselId), variant: VariantName(variant) }],
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
            { instanceId: brandedId, position: { column: 2, row: 1 }, size: { width: 3, height: 2 } },
          ],
        },
      };
    },
  });
}

/** Build a connector that responds with a tiling layout */
function connectorWithTilingLayout(instanceId: string, vesselId: string, variant: string) {
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
        instances: [{ instanceId: brandedId, vesselId: VesselId(vesselId), variant: VariantName(variant) }],
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
    const entry = vessel(testVessel, () => (
      <div>content</div>
    ));
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
    await act(async () => { await processTilingIntent('show orders'); });
    // Second intent: grid layout positions instance
    assertDefined(processIntent);
    const processGridIntent = processIntent;
    await act(async () => { await processGridIntent('layout as grid'); });

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
    await act(async () => { await processTilingIntent('x'); });
    // Second intent: grid layout positions instance
    assertDefined(processIntent);
    const processGridIntent = processIntent;
    await act(async () => { await processGridIntent('grid'); });

    expect(container.innerHTML).toContain('data-instance-id="inst-1"');
    // column=2 → gridColumnStart=3, width=3 → gridColumnEnd=6
    expect(container.innerHTML).toContain('grid-column: 3 / 6');
    // row=1 → gridRowStart=2, height=2 → gridRowEnd=4
    expect(container.innerHTML).toContain('grid-row: 2 / 4');
  });
});

describe('m.Chart — tiling layout', () => {
  it('renders vessel instance with absolute positioning in tiling layout', async () => {
    const entry = vessel(testVessel, () => (
      <div>tiling</div>
    ));
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

    await act(async () => { triggerResize(800, 600); });
    assertDefined(processIntent);
    const runIntent = processIntent;
    await act(async () => { await runIntent('show orders'); });

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

    const entry = vessel(
      testVessel,
      loader,
      () => <div>loading...</div>,
    );
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

    await act(async () => { triggerResize(800, 600); });
    assertDefined(processIntent);
    const processIntentSnapshot = processIntent;
    await act(async () => { await processIntentSnapshot('show orders'); });

    // First load attempt failed — error UI should appear
    expect(container.innerHTML).toContain('data-vessel-error="orders"');
    expect(loadAttempt).toBe(1);

    // Click retry button
    const retryButton = container.getElementsByTagName('button')[0];
    assertDefined(retryButton);
    await act(async () => { fireEvent.click(retryButton); });

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

    const dynamicLazyEntry = vessel(
      testVessel,
      loader,
      () => <div>loading...</div>,
    );

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

    await act(async () => { triggerResize(800, 600); });
    assertDefined(processIntent);
    const processIntentSnapshot = processIntent;
    await act(async () => { await processIntentSnapshot('show orders'); });

    // First load attempt failed — error UI should appear (proves the dynamic
    // entry was actually wired into lazyLoaderRegistry; otherwise the chart
    // would render null with no error boundary trigger).
    expect(container.innerHTML).toContain('data-vessel-error="orders"');
    expect(loadAttempt).toBe(1);

    const retryButton = container.getElementsByTagName('button')[0];
    assertDefined(retryButton);
    await act(async () => { fireEvent.click(retryButton); });

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
