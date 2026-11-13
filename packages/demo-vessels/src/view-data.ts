import type { AccentToken } from './lib/design-tokens';
import type { DemoLocation } from './lib/locations';
import type { RouteResult } from './lib/osrm';
import type {
  LiveWeather,
  WeatherLocation,
  WeatherUnits,
} from './lib/weather-data';

/** Calendar display data selected and dated by the host app. */
export interface CalendarEventView {
  /** Stable event identity. */
  readonly id: string;
  /** Event label. */
  readonly title: string;
  /** Local display time in H:MM format. */
  readonly time: string;
  /** Optional location label. */
  readonly location?: string;
  /** Optional event accent. */
  readonly accent?: AccentToken;
}

/** Journal data supplied by the host app. */
export interface JournalEntryView {
  /** Stable entry identity. */
  readonly id: string;
  /** Entry title. */
  readonly title: string;
  /** Plain text content. */
  readonly content: string;
  /** Formatted date label. */
  readonly date: string;
}

/** A displayed task or subtask. */
export interface TaskItemView {
  /** Stable record identity. */
  readonly id: string;
  /** Task label. */
  readonly title: string;
  /** Whether the record is complete. */
  readonly done: boolean;
}

/** A task with its app-owned subtasks. */
export interface TaskView extends TaskItemView {
  /** Child records in display order. */
  readonly subtasks: readonly TaskItemView[];
}

/** Map data; the host owns destination selection and route retrieval. */
export interface MapViewState {
  /** Selected route destination. */
  readonly destination?: DemoLocation;
  /** Retrieved driving route. */
  readonly route?: RouteResult;
  /** Selected compact-view location. */
  readonly focused?: DemoLocation;
}

/** Weather data; the host owns loading and failure handling. */
export interface WeatherViewState {
  /** Selected geographic location. */
  readonly location: WeatherLocation;
  /** Display units. */
  readonly units: WeatherUnits;
  /** Most recently available forecast. */
  readonly forecast: LiveWeather;
  /** Location whose request is pending. */
  readonly loadingLocation: string | null;
  /** User-facing load error. */
  readonly error: string | null;
}
