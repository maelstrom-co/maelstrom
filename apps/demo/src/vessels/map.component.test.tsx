// @vitest-environment happy-dom

import { isErr, isOk } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { mapVessel } from './map.vessel';

vi.mock('../lib/maelstrom', () => ({
  m: { useActions: vi.fn() },
}));

vi.mock('../lib/osrm', () => ({
  fetchRoute: vi.fn().mockRejectedValue(new Error('not used in this test')),
}));

class FakeLngLatBounds {
  points: unknown[] = [];
  extend(point: unknown) {
    this.points.push(point);
    return this;
  }
}

class FakeMarker {
  setLngLat() {
    return this;
  }
  setPopup() {
    return this;
  }
  addTo() {
    return this;
  }
  remove() {}
}

class FakePopup {
  setText() {
    return this;
  }
}

const mapInstances: FakeMap[] = [];
const { setWorkerUrl } = vi.hoisted(() => ({ setWorkerUrl: vi.fn() }));

class FakeMap {
  #handlers = new Map<string, Array<() => void>>();
  resizeCallCount = 0;
  removed = false;
  fitBoundsCalls: FakeLngLatBounds[] = [];

  constructor(_options?: unknown) {
    expect(setWorkerUrl).toHaveBeenCalledWith('/assets/map-worker.js');
    mapInstances.push(this);
  }

  on(event: string, handler: () => void) {
    const list = this.#handlers.get(event) ?? [];
    list.push(handler);
    this.#handlers.set(event, list);
  }

  once(event: string, handler: () => void) {
    this.on(event, handler);
  }

  // Fires every handler registered for `event` — mirrors MapLibre's own
  // 'load' event so tests can simulate the style finishing its load.
  trigger(event: string) {
    for (const handler of this.#handlers.get(event) ?? []) handler();
  }

  isStyleLoaded() {
    return false;
  }

  addSource() {}
  addLayer() {}
  getSource() {
    return undefined;
  }
  fitBounds(bounds: FakeLngLatBounds) {
    this.fitBoundsCalls.push(bounds);
  }
  flyTo() {}
  resize() {
    this.resizeCallCount += 1;
  }
  remove() {
    this.removed = true;
  }
}

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  Marker: FakeMarker,
  Popup: FakePopup,
  LngLatBounds: FakeLngLatBounds,
  setWorkerUrl,
}));

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '/assets/map-worker.js',
}));

// jsdom/happy-dom don't implement ResizeObserver — this fake records the
// observed target and exposes `trigger()` so tests can simulate a resize
// without a real layout engine.
const resizeObserverInstances: FakeResizeObserver[] = [];

class FakeResizeObserver {
  #callback: () => void;
  target: Element | null = null;
  disconnected = false;

  constructor(callback: () => void) {
    this.#callback = callback;
    resizeObserverInstances.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  disconnect() {
    this.disconnected = true;
  }

  trigger() {
    this.#callback();
  }
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

const { mapActionRunner } = await import('./map.component');
const { mapActions, getMapSnapshot } = await import('./map.store');
const MapComponent = (await import('./map.component')).default;
const { DEMO_LOCATIONS, HOME } = await import('../lib/locations');

function props(): TypedVesselProps<typeof mapVessel> {
  return {
    instanceId: 'map-test',
    variantProps: { variant: 'overview' },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof mapVessel>;
}

beforeEach(() => {
  setWorkerUrl.mockClear();
  mapActions.showOverview();
  mapInstances.length = 0;
  resizeObserverInstances.length = 0;
});

afterEach(cleanup);

describe('mapActionRunner', () => {
  it('showRoute fuzzy-matches a destination and sets it', async () => {
    const result = await mapActionRunner.showRoute({ destination: 'vortex' });
    expect(isOk(result)).toBe(true);
    expect(getMapSnapshot()).toEqual({
      destination: DEMO_LOCATIONS.find((loc) => loc.id === 'office'),
    });
  });

  it('showRoute returns err listing available names on no match', async () => {
    const result = await mapActionRunner.showRoute({
      destination: 'nonexistent place',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain(
        'No location matches "nonexistent place"',
      );
      for (const loc of DEMO_LOCATIONS) {
        expect(result.error.message).toContain(`"${loc.name}"`);
      }
    }
  });

  it('focusLocation fuzzy-matches a name and sets the focused location', async () => {
    const result = await mapActionRunner.focusLocation({ name: 'gym' });
    expect(isOk(result)).toBe(true);
    expect(getMapSnapshot()).toEqual({
      focused: DEMO_LOCATIONS.find((loc) => loc.id === 'gym'),
    });
  });

  it('focusLocation returns err listing available names on no match', async () => {
    const result = await mapActionRunner.focusLocation({ name: 'nowhere' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('No location matches "nowhere"');
    }
  });

  it('showOverview clears all data', async () => {
    await mapActionRunner.focusLocation({ name: 'gym' });
    const result = await mapActionRunner.showOverview();
    expect(isOk(result)).toBe(true);
    expect(getMapSnapshot()).toEqual({});
  });
});

describe('MapComponent smoke render', () => {
  it('configures the bundled worker before creating a map so sources can load', () => {
    render(<MapComponent {...props()} />);
    expect(setWorkerUrl).toHaveBeenCalledExactlyOnceWith(
      '/assets/map-worker.js',
    );
  });

  it('mounts without crashing with maplibre-gl mocked', () => {
    const { container } = render(<MapComponent {...props()} />);
    expect(container.textContent).toContain('places');
  });

  it('renders overview content for variant=overview even when the store holds stale route data', () => {
    const office = DEMO_LOCATIONS.find((loc) => loc.id === 'office');
    if (!office) throw new Error('fixture location "office" not found');
    mapActions.showRoute(office);

    const { container } = render(
      <MapComponent {...props()} variantProps={{ variant: 'overview' }} />,
    );

    expect(container.textContent).toContain('places');
    expect(container.textContent).not.toContain(office.name);
  });

  it('falls back to overview content for variant=route when the store has no destination', () => {
    mapActions.showOverview();

    const { container } = render(
      <MapComponent {...props()} variantProps={{ variant: 'route' }} />,
    );

    expect(container.textContent).toContain('places');
  });
});

describe('MapComponent resize handling', () => {
  // The orchestrator resizes vessel containers constantly (grid moves,
  // variant transitions). MapLibre's own trackResize only follows window
  // resizes, so the canvas goes stale unless the container itself is
  // observed and map.resize() is called on every observed change.
  it('observes the map container with a ResizeObserver and calls map.resize() when it fires', () => {
    const { container } = render(<MapComponent {...props()} />);

    expect(resizeObserverInstances).toHaveLength(1);
    const observer = resizeObserverInstances[0];
    const map = mapInstances[0];
    expect(observer.target).not.toBeNull();
    expect(container.contains(observer.target)).toBe(true);

    expect(map.resizeCallCount).toBe(0);
    observer.trigger();
    expect(map.resizeCallCount).toBe(1);

    observer.trigger();
    observer.trigger();
    expect(map.resizeCallCount).toBe(3);
  });

  it('disconnects the ResizeObserver on unmount and ignores a stray callback after the map is removed', () => {
    const { unmount } = render(<MapComponent {...props()} />);

    const observer = resizeObserverInstances[0];
    const map = mapInstances[0];
    unmount();

    expect(observer.disconnected).toBe(true);
    expect(map.removed).toBe(true);

    // Guards against a ResizeObserver notification that was already queued
    // before disconnect() took effect — must not throw or resize a removed map.
    expect(() => observer.trigger()).not.toThrow();
    expect(map.resizeCallCount).toBe(0);
  });
});

describe('MapComponent style-ready latch', () => {
  // MapLibre's `Map.isStyleLoaded()` delegates to `Style.loaded()`, which
  // reports false while tiles/sources are still streaming — long after the
  // 'load' event already fired once. A sync gated on `isStyleLoaded()` would
  // register a `once('load', ...)` that never runs (the event already fired
  // and won't recur), dropping the sync forever. These tests pin that an
  // app-owned one-shot latch — not `isStyleLoaded()` — gates the sync.

  it('syncs to the map for a state change after load has already fired, even though isStyleLoaded() still reports false', () => {
    const { rerender } = render(<MapComponent {...props()} />);
    const map = mapInstances[0];

    // 'load' fires exactly once per map instance; it already happened.
    map.trigger('load');

    const office = DEMO_LOCATIONS.find((loc) => loc.id === 'office');
    if (!office) throw new Error('fixture location "office" not found');
    mapActions.showRoute(office);
    rerender(<MapComponent {...props()} variantProps={{ variant: 'route' }} />);

    // The route branch extends exactly 2 points (HOME + destination).
    const routeCalls = map.fitBoundsCalls.filter((b) => b.points.length === 2);
    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0]?.points).toEqual([
      [HOME.lng, HOME.lat],
      [office.lng, office.lat],
    ]);
  });

  it('applies a second post-load sync too — the latch is not single-use', () => {
    const { rerender } = render(<MapComponent {...props()} />);
    const map = mapInstances[0];
    map.trigger('load');

    const office = DEMO_LOCATIONS.find((loc) => loc.id === 'office');
    const gym = DEMO_LOCATIONS.find((loc) => loc.id === 'gym');
    if (!office || !gym) throw new Error('fixture location not found');

    mapActions.showRoute(office);
    rerender(<MapComponent {...props()} variantProps={{ variant: 'route' }} />);

    mapActions.showRoute(gym);
    rerender(<MapComponent {...props()} variantProps={{ variant: 'route' }} />);

    const routeCalls = map.fitBoundsCalls.filter((b) => b.points.length === 2);
    expect(routeCalls).toHaveLength(2);
    expect(routeCalls[1]?.points).toEqual([
      [HOME.lng, HOME.lat],
      [gym.lng, gym.lat],
    ]);
  });

  it('still performs the initial sync once the style loads, reflecting state that changed before load fired — not a stale variant from the first render', () => {
    const office = DEMO_LOCATIONS.find((loc) => loc.id === 'office');
    if (!office) throw new Error('fixture location "office" not found');

    const { rerender } = render(<MapComponent {...props()} />);
    const map = mapInstances[0];

    mapActions.showRoute(office);
    rerender(<MapComponent {...props()} variantProps={{ variant: 'route' }} />);

    map.trigger('load');

    // Exactly one fitBounds call should have fired: the route-shaped one
    // reflecting `office`. A stale variant captured from the first render
    // (variant='overview') would additionally produce a wrong overview-shaped
    // fitBounds call over all demo locations.
    expect(map.fitBoundsCalls).toHaveLength(1);
    expect(map.fitBoundsCalls[0]?.points).toEqual([
      [HOME.lng, HOME.lat],
      [office.lng, office.lat],
    ]);
  });
});

describe('MapComponent container sizing (cascade-collapse guard)', () => {
  it('sizes the map container with h-full/w-full, never absolute', () => {
    const { container } = render(<MapComponent {...props()} />);
    const mapContainer = container.querySelector('.h-full.w-full');
    expect(mapContainer).not.toBeNull();
    expect(mapContainer?.className).not.toContain('absolute');
  });
});
