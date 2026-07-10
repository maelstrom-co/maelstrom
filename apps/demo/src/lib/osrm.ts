import type { DemoLocation } from './locations';

/** A driving route between two demo locations, mapped from OSRM's response. */
export interface RouteResult {
  durationMin: number;
  distanceMi: number;
  geometry: GeoJSON.LineString;
}

interface OsrmResponse {
  code: string;
  routes: ReadonlyArray<{
    duration: number; // seconds
    distance: number; // meters
    geometry: GeoJSON.LineString;
  }>;
}

const METERS_PER_MILE = 1609.344;

/**
 * Fetches a driving route between two demo locations from OSRM's public
 * demo server (no API key required) and maps it to {@link RouteResult}.
 * Rejects on any network failure, non-200 response, or a response with no
 * route — callers should catch and keep the destination visible without a
 * route line rather than surfacing an error state.
 */
export async function fetchRoute(
  from: DemoLocation,
  to: DemoLocation,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteResult> {
  const url =
    'https://router.project-osrm.org/route/v1/driving/' +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`OSRM request failed with status ${response.status}`);
  }
  const data = (await response.json()) as OsrmResponse;
  const route = data.routes[0];
  if (data.code !== 'Ok' || !route) {
    throw new Error(`OSRM returned no route (code: ${data.code})`);
  }

  return {
    durationMin: Math.round(route.duration / 60),
    distanceMi: Math.round((route.distance / METERS_PER_MILE) * 10) / 10,
    geometry: route.geometry,
  };
}
