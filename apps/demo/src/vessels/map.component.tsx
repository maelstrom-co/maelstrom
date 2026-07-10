import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { err, ok } from '@maelstrom-co/protocol';
import type { TypedVesselProps } from '@maelstrom-co/react';
import { VesselCard } from '../components/vessel-card';
import { m } from '../lib/maelstrom';
import { DEMO_LOCATIONS, findLocationByFuzzyName, HOME } from '../lib/locations';
import { fetchRoute } from '../lib/osrm';
import { getMapSnapshot, mapActions, useMapStore, type MapState } from './map.store';
import type { mapVessel } from './map.vessel';

function noMatchError(name: string): Error {
  const available = DEMO_LOCATIONS.map((loc) => `"${loc.name}"`).join(', ');
  return new Error(`No location matches "${name}". Available: ${available}`);
}

/**
 * Action handlers for the `map` vessel, kept independent of MapLibre so they
 * can be exercised directly in tests without a WebGL context.
 */
export const mapActionRunner = {
  showRoute: async ({ destination }: { destination: string }) => {
    const match = findLocationByFuzzyName(destination);
    if (!match) return err(noMatchError(destination));
    mapActions.showRoute(match);
    return ok(undefined);
  },
  showOverview: async () => {
    mapActions.showOverview();
    return ok(undefined);
  },
  focusLocation: async ({ name }: { name: string }) => {
    const match = findLocationByFuzzyName(name);
    if (!match) return err(noMatchError(name));
    mapActions.focusLocation(match);
    return ok(undefined);
  },
};

const ROUTE_SOURCE_ID = 'map-vessel-route';
const ROUTE_LAYER_ID = 'map-vessel-route-line';
// Matches VesselCard's violet accent (--color-violet-accent in styles.css).
const ACCENT_COLOR = '#6b00ff';

type MapVariant = 'overview' | 'route' | 'compact';

function emptyRouteData(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function routeData(
  variant: MapVariant,
  state: MapState,
): GeoJSON.FeatureCollection {
  if (variant !== 'route' || !state.route) return emptyRouteData();
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: state.route.geometry },
    ],
  };
}

// The framework's variant is authoritative, but an instance can be
// dropped/re-added (tiling mode) resetting the variant to the vessel's
// default while this module-singleton store keeps stale data from a
// previous instance. Fall back to overview whenever the data a variant
// needs isn't actually there.
function resolveVariant(variant: MapVariant, state: MapState): MapVariant {
  if (variant === 'route' && !state.destination) return 'overview';
  if (variant === 'compact' && !state.focused) return 'overview';
  return variant;
}

function addLocationMarkers(map: maplibregl.Map): void {
  for (const loc of DEMO_LOCATIONS) {
    new maplibregl.Marker({ color: ACCENT_COLOR })
      .setLngLat([loc.lng, loc.lat])
      .setPopup(new maplibregl.Popup({ offset: 12 }).setText(loc.name))
      .addTo(map);
  }
}

function syncMapToState(
  map: maplibregl.Map,
  variant: MapVariant,
  state: MapState,
): void {
  const effective = resolveVariant(variant, state);

  const source = map.getSource(ROUTE_SOURCE_ID) as
    | maplibregl.GeoJSONSource
    | undefined;
  source?.setData(routeData(effective, state));

  if (effective === 'route' && state.destination) {
    const bounds = new maplibregl.LngLatBounds();
    bounds.extend([HOME.lng, HOME.lat]);
    bounds.extend([state.destination.lng, state.destination.lat]);
    map.fitBounds(bounds, { padding: 64, duration: 0 });
  } else if (effective === 'compact' && state.focused) {
    map.flyTo({
      center: [state.focused.lng, state.focused.lat],
      zoom: 15,
      duration: 0,
    });
  } else {
    const bounds = new maplibregl.LngLatBounds();
    for (const loc of DEMO_LOCATIONS) bounds.extend([loc.lng, loc.lat]);
    map.fitBounds(bounds, { padding: 48, duration: 0 });
  }
}

export default function MapComponent({
  instanceId,
  variantProps,
}: TypedVesselProps<typeof mapVessel>) {
  const state = useMapStore();
  const variant = variantProps.variant;
  const effectiveVariant = resolveVariant(variant, state);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  m.useActions('map', instanceId, mapActionRunner);

  // Map instance is created client-only, inside an effect — importing
  // maplibre-gl is safe at module scope, but constructing a Map touches
  // WebGL/canvas APIs that don't exist during SSR.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: [HOME.lng, HOME.lat],
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource(ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: emptyRouteData(),
      });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: 'line',
        source: ROUTE_SOURCE_ID,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ACCENT_COLOR,
          'line-width': 4,
          'line-opacity': 0.85,
        },
      });
      // Location markers are fixed for the demo's lifetime — created once
      // here rather than on every state sync, which only needs to touch the
      // route layer data and the viewport bounds.
      addLocationMarkers(map);
      syncMapToState(map, variantProps.variant, getMapSnapshot());
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Maelstrom resizes vessels constantly; MapLibre's canvas otherwise goes
  // stale (wrong size/blank tiles) until the browser forces a repaint.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) {
      map.once('load', () => syncMapToState(map, variant, state));
      return;
    }
    syncMapToState(map, variant, state);
  }, [variant, state]);

  // Fetch the route once per destination; the early return once state.route
  // is set also prevents refetching after the destination moves away and
  // back.
  useEffect(() => {
    if (variant !== 'route' || !state.destination || state.route) return;
    const destination = state.destination;
    let cancelled = false;
    fetchRoute(HOME, destination)
      .then((route) => {
        if (!cancelled) mapActions.setRoute(route);
      })
      .catch(() => {
        // Graceful degradation: keep the destination card, no route line.
      });
    return () => {
      cancelled = true;
    };
  }, [variant, state]);

  return (
    <VesselCard
      accent="violet"
      label="Map"
      meta={metaFor(effectiveVariant, state)}
    >
      <div className="relative flex-1 rounded-lg overflow-hidden">
        {/* Sized with h-full/w-full, not absolute inset-0: MapLibre adds its
            own .maplibregl-map class (position: relative) to this div, and
            its stylesheet loads after Tailwind's utilities, so at equal
            specificity it overrides `absolute` — collapsing an inset-sized
            box to zero height and clipping the canvas invisible. Height-based
            sizing doesn't depend on `position`, so the override is harmless. */}
        <div ref={containerRef} className="h-full w-full" />
        {effectiveVariant === 'route' && state.route && (
          <div className="absolute bottom-2 left-2 right-2 rounded-md bg-black/70 backdrop-blur px-3 py-1.5 text-sm text-white/90 font-mono">
            {state.route.durationMin} min ·{' '}
            {state.route.distanceMi.toFixed(1)} mi
          </div>
        )}
      </div>
    </VesselCard>
  );
}

function metaFor(variant: MapVariant, state: MapState): string {
  if (variant === 'route' && state.destination) {
    return `To ${state.destination.name}`;
  }
  if (variant === 'compact' && state.focused) return state.focused.name;
  return `${DEMO_LOCATIONS.length} places`;
}
