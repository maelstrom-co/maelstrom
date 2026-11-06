import {
  findLocationByFuzzyName,
  HOME,
} from '@maelstrom-co/demo-vessels/lib/locations';
import { fetchRoute } from '@maelstrom-co/demo-vessels/lib/osrm';
import {
  fetchGeocodedLocation,
  fetchLiveWeather,
  unitsForCountry,
} from '@maelstrom-co/demo-vessels/lib/weather-data';
import type { LabMarkerSlug } from '@maelstrom-co/demo-vessels/vessels/labs.vessel.def';
import type {
  MapViewState,
  WeatherViewState,
} from '@maelstrom-co/demo-vessels/view-data';
import { err, ok } from '@maelstrom-co/protocol';
import { createContext, useContext, useSyncExternalStore } from 'react';
import { z } from 'zod';

import { type Records, RecordsSchema } from '../records';
import type { WorkspaceRequest } from './goal-runner';
import type { WorkspaceConnector } from './workspace-connector';

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface ViewState {
  records: Records;
  entryId: string | null;
  calendarDate: string;
  marker: LabMarkerSlug | null;
  map: MapViewState;
  weather?: WeatherViewState;
  weatherError?: string;
}

export class WorkspaceState {
  private value: ViewState;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private weatherLoad?: Promise<void>;

  constructor(
    records: Records,
    readonly connector: WorkspaceConnector,
    readonly request: WorkspaceRequest,
  ) {
    this.value = {
      records,
      entryId: null,
      calendarDate: localDate(),
      marker: null,
      map: {},
    };
  }

  snapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(value: Partial<ViewState>) {
    if (this.lifetime.signal.aborted)
      throw new Error('Workspace view retired.');
    this.value = { ...this.value, ...value };
    for (const listener of this.listeners) listener();
  }
  dispose() {
    this.lifetime.abort();
  }

  async action(
    instanceId: string,
    name: string,
    perform?: () => void | Promise<void>,
  ) {
    try {
      this.lifetime.signal.throwIfAborted();
      const operation = this.connector.claimAction(instanceId, name);
      if (perform) await perform();
      else {
        const response = await this.request(
          '/api/workspace/operations',
          operation,
          this.lifetime.signal,
        );
        if (!response.ok) throw new Error('Record operation stopped.');
        const result = z
          .object({ records: RecordsSchema, recordId: z.string() })
          .parse(await response.json());
        const event = result.records.calendar.find(
          ({ id }) => id === result.recordId,
        );
        const entry = result.records.journal.find(
          ({ id }) => id === result.recordId,
        );
        this.update({
          records: result.records,
          ...(entry ? { entryId: entry.id } : {}),
          ...(event ? { calendarDate: event.date } : {}),
        });
      }
      this.lifetime.signal.throwIfAborted();
      return ok(undefined);
    } catch (error) {
      return err(
        error instanceof Error
          ? error
          : new Error('Application Action failed.'),
      );
    }
  }

  selectEntry(params: unknown) {
    const target = z
      .object({ id: z.string(), version: z.number().int().positive() })
      .parse(params);
    if (
      !this.value.records.journal.some(
        ({ id, version }) => id === target.id && version === target.version,
      )
    )
      throw new Error('Journal selection changed.');
    this.update({ entryId: target.id });
  }

  async setLocation(name: string) {
    const location = await fetchGeocodedLocation(
      name,
      fetch,
      this.lifetime.signal,
    );
    const units = unitsForCountry(location.countryCode);
    const forecast = await fetchLiveWeather(
      location.latitude,
      location.longitude,
      units,
      fetch,
      this.lifetime.signal,
    );
    this.update({
      weather: {
        location,
        units,
        forecast,
        loadingLocation: null,
        error: null,
      },
      weatherError: undefined,
    });
  }

  loadWeather() {
    if (this.weatherLoad) return this.weatherLoad;
    this.weatherLoad = (async () => {
      try {
        const units = unitsForCountry('US');
        const forecast = await fetchLiveWeather(
          HOME.lat,
          HOME.lng,
          units,
          fetch,
          this.lifetime.signal,
        );
        if (!this.value.weather)
          this.update({
            weather: {
              location: {
                name: 'San Francisco',
                country: 'United States',
                countryCode: 'US',
                latitude: HOME.lat,
                longitude: HOME.lng,
              },
              units,
              forecast,
              loadingLocation: null,
              error: null,
            },
          });
      } catch {
        if (!this.lifetime.signal.aborted)
          this.update({ weatherError: 'Live weather could not be loaded.' });
      }
    })();
    return this.weatherLoad;
  }

  async routeTo(name: string) {
    const destination = findLocationByFuzzyName(name);
    if (!destination) throw new Error('Unknown saved location.');
    const route = await fetchRoute(
      HOME,
      destination,
      fetch,
      this.lifetime.signal,
    );
    this.update({ map: { destination, route } });
  }
  focusLocation(name: string) {
    const focused = findLocationByFuzzyName(name);
    if (!focused) throw new Error('Unknown saved location.');
    this.update({ map: { focused } });
  }
}

export const WorkspaceContext = createContext<WorkspaceState | null>(null);
export function useWorkspace() {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error('Workspace provider missing.');
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  return { store, state };
}
