import { describe, expect, it, vi } from 'vitest';
import { fetchRoute } from './osrm';

const HOME = { id: 'home' as const, name: 'Home', lng: -122.433, lat: 37.7648 };
const OFFICE = {
  id: 'office' as const,
  name: 'Studio Vortex HQ',
  lng: -122.4194,
  lat: 37.7793,
};

// Captured from a live call to
// https://router.project-osrm.org/route/v1/driving/-122.433,37.7648;-122.4194,37.7793?overview=full&geometries=geojson
const REAL_OSRM_RESPONSE = {
  code: 'Ok',
  routes: [
    {
      legs: [
        {
          steps: [],
          weight: 356.3,
          summary: '',
          duration: 356.3,
          distance: 2325.2,
        },
      ],
      weight_name: 'routability',
      geometry: {
        coordinates: [
          [-122.433163, 37.764788],
          [-122.433118, 37.764409],
          [-122.42, 37.779224],
        ],
        type: 'LineString',
      },
      weight: 356.3,
      duration: 356.3,
      distance: 2325.2,
    },
  ],
  waypoints: [
    {
      hint: 'M5Sag3zRTYs8AAAAGAAAABEAAAAAAAAAhAIpQlUkg0EUxTxBAAAAADwAAAAYAAAAEQAAAAAAAABgegAAddGz-LQ-QAIY0rP4wD5AAgIALxYAAAAA',
      location: [-122.433163, 37.764788],
      name: 'Noe Street',
      distance: 14.42195656,
    },
    {
      hint: 'emk_g____39kAAAAegAAABEAAABYAAAAiFy0QgUWl0HBeXZBdlycQmQAAAB6AAAAEQAAAFgAAABgegAA4AS0-Bh3QAI4B7T4ZHdAAgIA7xUAAAAA',
      location: [-122.42, 37.779224],
      name: 'Van Ness Avenue',
      distance: 53.52891174,
    },
  ],
};

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('fetchRoute', () => {
  it('requests the OSRM driving route between two points', async () => {
    const fetchImpl = fakeFetch(REAL_OSRM_RESPONSE);
    await fetchRoute(HOME, OFFICE, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://router.project-osrm.org/route/v1/driving/' +
        '-122.433,37.7648;-122.4194,37.7793?overview=full&geometries=geojson',
    );
  });

  it('maps duration (seconds) to whole minutes and distance (meters) to miles', async () => {
    const route = await fetchRoute(HOME, OFFICE, fakeFetch(REAL_OSRM_RESPONSE));
    // 356.3s -> 5.9min -> rounds to 6; 2325.2m -> 1.445mi -> rounds to 1.4
    expect(route.durationMin).toBe(6);
    expect(route.distanceMi).toBe(1.4);
  });

  it('passes through the route geometry unchanged', async () => {
    const route = await fetchRoute(HOME, OFFICE, fakeFetch(REAL_OSRM_RESPONSE));
    expect(route.geometry).toEqual(REAL_OSRM_RESPONSE.routes[0].geometry);
  });

  it('throws when the HTTP response is not ok', async () => {
    await expect(
      fetchRoute(HOME, OFFICE, fakeFetch({}, false, 503)),
    ).rejects.toThrow(/503/);
  });

  it('throws when OSRM reports no route', async () => {
    await expect(
      fetchRoute(
        HOME,
        OFFICE,
        fakeFetch({ code: 'NoRoute', routes: [], waypoints: [] }),
      ),
    ).rejects.toThrow();
  });
});
