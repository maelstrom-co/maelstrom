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
  extend() {
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

class FakeMap {
  #handlers = new Map<string, Array<() => void>>();

  on(event: string, handler: () => void) {
    const list = this.#handlers.get(event) ?? [];
    list.push(handler);
    this.#handlers.set(event, list);
  }

  once(event: string, handler: () => void) {
    this.on(event, handler);
  }

  isStyleLoaded() {
    return false;
  }

  addSource() {}
  addLayer() {}
  getSource() {
    return undefined;
  }
  fitBounds() {}
  flyTo() {}
  resize() {}
  remove() {}
}

vi.mock('maplibre-gl', () => ({
  default: {
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    LngLatBounds: FakeLngLatBounds,
  },
}));

// jsdom/happy-dom don't implement ResizeObserver.
class FakeResizeObserver {
  observe() {}
  disconnect() {}
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
});

afterEach(cleanup);

describe('mapActionRunner', () => {
  it('showRoute fuzzy-matches a destination and enters route mode', async () => {
    const result = await mapActionRunner.showRoute({ destination: 'vortex' });
    expect(isOk(result)).toBe(true);
    expect(getMapSnapshot()).toEqual({
      mode: 'route',
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

  it('focusLocation fuzzy-matches a name and enters focus mode', async () => {
    const result = await mapActionRunner.focusLocation({ name: 'gym' });
    expect(isOk(result)).toBe(true);
    expect(getMapSnapshot()).toEqual({
      mode: 'focus',
      location: DEMO_LOCATIONS.find((loc) => loc.id === 'gym'),
    });
  });

  it('focusLocation returns err listing available names on no match', async () => {
    const result = await mapActionRunner.focusLocation({ name: 'nowhere' });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('No location matches "nowhere"');
    }
  });

  it('showOverview resets to overview mode', async () => {
    await mapActionRunner.focusLocation({ name: 'gym' });
    const result = await mapActionRunner.showOverview();
    expect(isOk(result)).toBe(true);
    expect(getMapSnapshot()).toEqual({ mode: 'overview' });
  });
});

describe('MapComponent smoke render', () => {
  it('mounts without crashing with maplibre-gl mocked', () => {
    const { container } = render(<MapComponent {...props()} />);
    expect(container.textContent).toContain('places');
  });
});
