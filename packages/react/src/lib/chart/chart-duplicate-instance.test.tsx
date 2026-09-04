import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
} from 'bun:test';
import type { GridLayout, TilingLayout } from '@maelstrom-co/protocol';
import {
  InstanceId,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { act, cleanup, render } from '@testing-library/react';
import { resetWarnings } from '../../_testing.js';
import { createMockConnector } from '../__tests__/mock-connector.js';
import { testVessel } from '../__tests__/test-vessel.fixture.js';
import { createMaelstromContext } from '../context.js';
import { createProvider } from '../provider.js';
import { vessel } from '../vessel.js';
import { createChart } from './chart.js';

// A repeated instanceId is a producer bug the client gates refuse for tiling
// layouts and deliberately allow for grid ones. Either way the Chart is the
// last line: it must not hand React two siblings under one key, because
// reconciliation resolves that by dropping or reusing a subtree — vessel
// state attaching to the wrong tile with nothing on screen to say so.

type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void;
let capturedObservers: ResizeObserverCallback[] = [];

const warnings: string[] = [];
const errors: string[] = [];
let restorers: Array<() => void> = [];

beforeAll(() => {
  // @ts-expect-error happy-dom does not implement ResizeObserver
  globalThis.ResizeObserver = class MockResizeObserver {
    #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe() {
      capturedObservers.push(this.#callback);
    }
    disconnect() {
      capturedObservers = capturedObservers.filter((c) => c !== this.#callback);
    }
    unobserve() {}
  };
});

beforeEach(() => {
  resetWarnings();
  const warnSpy = spyOn(console, 'warn').mockImplementation(
    (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    },
  );
  const errorSpy = spyOn(console, 'error').mockImplementation(
    (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    },
  );
  restorers = [() => warnSpy.mockRestore(), () => errorSpy.mockRestore()];
});

afterEach(() => {
  cleanup();
  for (const restore of restorers) restore();
  warnings.length = 0;
  errors.length = 0;
  capturedObservers = [];
});

const entry = vessel(testVessel, () => <div>content</div>);
const seededId = InstanceId('orders-main');
const seededLeaf = tilingLeafToken(seededId);
const duplicateWarning = `[Maelstrom] Duplicate instanceId "${seededId}" in layout; tiles overlap`;

function seedLayout(): TilingLayout {
  return {
    type: 'tiling',
    tree: [seededLeaf],
    instances: [
      {
        instanceId: seededId,
        vesselId: VesselId('orders'),
        variant: VariantName('list'),
      },
    ],
  };
}

/** Mounts a Chart on a one-tile seed, then clears the console capture. */
function renderSeededChart() {
  const contextPair = createMaelstromContext();
  const Provider = createProvider(contextPair, [entry], {});
  const Chart = createChart(contextPair);

  let container!: HTMLElement;
  act(() => {
    ({ container } = render(
      <Provider connector={createMockConnector()} initialLayout={seedLayout()}>
        <Chart />
      </Provider>,
    ));
  });

  const commandProcessor =
    contextPair.contextRef.current?.orchestrator.commandProcessor;
  if (!commandProcessor) throw new Error('expected an Orchestrator');

  warnings.length = 0;
  errors.length = 0;
  return { container, commandProcessor };
}

function resizeTo(width: number, height: number) {
  for (const callback of capturedObservers) {
    callback([
      { contentRect: { width, height, x: 0, y: 0 } },
    ] as unknown as ResizeObserverEntry[]);
  }
}

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('m.Chart — duplicate instanceId keys', () => {
  it('renders a repeated grid position as its own subtree under a suffixed key', async () => {
    const { container, commandProcessor } = renderSeededChart();

    // The gate lets this through: a repeat in a grid layout is a
    // repositioning of one instance, not a second tile.
    const grid: GridLayout = {
      type: 'grid',
      positions: [
        {
          instanceId: seededId,
          position: { column: 0, row: 0 },
          size: { width: 2, height: 2 },
        },
        {
          instanceId: seededId,
          position: { column: 2, row: 0 },
          size: { width: 2, height: 2 },
        },
      ],
    };

    await act(async () => {
      commandProcessor.setLayout(grid);
      await commandProcessor.waitForIdle();
    });

    expect(
      occurrences(container.innerHTML, `data-instance-id="${seededId}"`),
    ).toBe(2);
    expect(warnings).toEqual([duplicateWarning]);
    expect(errors.join('\n')).not.toContain('same key');
  });

  it('renders a repeated tiling leaf as its own subtree under a suffixed key', async () => {
    const { container, commandProcessor } = renderSeededChart();

    await act(async () => {
      resizeTo(800, 600);
    });

    // The `set_layout` gate refuses this layout, so the only way it reaches
    // the renderer is a caller that routed around the CommandProcessor —
    // exactly the case the gate's docs promise stays visible rather than
    // silently collapsing to one tile.
    const duplicate: TilingLayout = {
      ...seedLayout(),
      tree: ['V', seededLeaf, seededLeaf],
    };
    await act(async () => {
      commandProcessor.store.setState((state) => ({
        ...state,
        layout: duplicate,
      }));
    });

    expect(
      occurrences(container.innerHTML, `data-instance-id="${seededId}"`),
    ).toBe(2);
    expect(warnings).toEqual([duplicateWarning]);
    expect(errors.join('\n')).not.toContain('same key');
  });

  it('leaves keys untouched and stays silent when every instanceId is distinct', async () => {
    const { container, commandProcessor } = renderSeededChart();

    await act(async () => {
      resizeTo(800, 600);
    });

    const otherId = InstanceId('orders-side');
    await act(async () => {
      commandProcessor.setLayout({
        type: 'tiling',
        tree: ['V', seededLeaf, tilingLeafToken(otherId)],
        instances: [
          {
            instanceId: seededId,
            vesselId: VesselId('orders'),
            variant: VariantName('list'),
          },
          {
            instanceId: otherId,
            vesselId: VesselId('orders'),
            variant: VariantName('list'),
          },
        ],
      });
      await commandProcessor.waitForIdle();
    });

    expect(
      occurrences(container.innerHTML, `data-instance-id="${seededId}"`),
    ).toBe(1);
    expect(
      occurrences(container.innerHTML, `data-instance-id="${otherId}"`),
    ).toBe(1);
    expect(warnings).toEqual([]);
  });
});
