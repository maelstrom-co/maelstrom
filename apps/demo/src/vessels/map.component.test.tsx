// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isErr, isOk } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
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

class FakeMap {
  #handlers = new Map<string, Array<() => void>>();
  resizeCallCount = 0;
  removed = false;
  fitBoundsCalls: FakeLngLatBounds[] = [];

  constructor(_options?: unknown) {
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
  default: {
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    LngLatBounds: FakeLngLatBounds,
  },
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
const { DEMO_LOCATIONS } = await import('../lib/locations');

function props(): TypedVesselProps<typeof mapVessel> {
  return {
    instanceId: 'map-test',
    variantProps: { variant: 'overview' },
    executeAction: vi.fn(),
  } as unknown as TypedVesselProps<typeof mapVessel>;
}

beforeEach(() => {
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

describe('MapComponent pending load sync', () => {
  it('applies only the latest state once the style finishes loading, not every stale state in between', () => {
    const gym = DEMO_LOCATIONS.find((loc) => loc.id === 'gym');
    const cafe = DEMO_LOCATIONS.find((loc) => loc.id === 'cafe');
    if (!gym || !cafe) throw new Error('fixture location not found');

    const { rerender } = render(<MapComponent {...props()} />);
    const map = mapInstances[0];

    mapActions.showRoute(gym);
    rerender(<MapComponent {...props()} variantProps={{ variant: 'route' }} />);

    mapActions.showRoute(cafe);
    rerender(<MapComponent {...props()} variantProps={{ variant: 'route' }} />);

    map.trigger('load');

    // The route branch extends exactly 2 points (HOME + destination); the
    // overview branch (from the mount-time 'load' handler) extends all 4
    // demo locations. Only one route-shaped fitBounds call should have
    // fired, and it must reflect the LATEST destination (cafe), not gym.
    const routeCalls = map.fitBoundsCalls.filter((b) => b.points.length === 2);
    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0]?.points).toContainEqual([cafe.lng, cafe.lat]);
    expect(routeCalls[0]?.points).not.toContainEqual([gym.lng, gym.lat]);
  });
});
