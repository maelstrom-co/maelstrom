import { withFetchTimeout } from './fetch-timeout';
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
 * Rejects on any network failure, non-200 response, a response with no
 * route, or a stalled connection past the timeout — callers should catch
 * and keep the destination visible without a route line rather than
 * surfacing an error state.
 */
export async function fetchRoute(
  from: DemoLocation,
  to: DemoLocation,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const url =
    'https://router.project-osrm.org/route/v1/driving/' +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;

  const response = await fetchImpl(url, { signal: withFetchTimeout(signal) });
  if (!response.ok) {
    throw new Error(`OSRM request failed with status ${response.status}`);
  }
  const data = (await response.json()) as OsrmResponse;
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(`OSRM returned no route (code: ${data.code})`);
  }
  const route = data.routes[0];

  return {
    durationMin: Math.round(route.duration / 60),
    distanceMi: Math.round((route.distance / METERS_PER_MILE) * 10) / 10,
    geometry: route.geometry,
  };
}
