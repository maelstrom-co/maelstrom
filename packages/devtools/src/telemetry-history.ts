import type { Telemetry, TelemetrySnapshot } from '@maelstrom-co/telemetry';

export const TELEMETRY_HISTORY_LIMIT = 120;

interface SampleTime {
  readonly sequence: number;
  readonly at: number;
  readonly elapsedMs: number;
  readonly gap?: string;
  readonly interval?: TelemetryInterval;
}

export interface TelemetryInterval {
  readonly seconds: number;
  readonly accepted: number;
  readonly delivered: number;
  readonly lost: number;
}

export type TelemetrySample = SampleTime &
  (
    | { readonly status: 'available'; readonly snapshot: TelemetrySnapshot }
    | { readonly status: 'unavailable'; readonly snapshot?: never }
  );

export interface TelemetryWindow {
  readonly samples: readonly TelemetrySample[];
  readonly expired: number;
  readonly seconds: number;
  readonly accepted: number;
  readonly delivered: number;
  readonly lost: number;
}

export function losses(snapshot: TelemetrySnapshot): number {
  return Object.values(snapshot.dropped).reduce((sum, count) => sum + count, 0);
}

export class TelemetryHistory {
  private samples: TelemetrySample[] = [];
  private sequence = 0;
  private expired = 0;
  private gap: string | undefined;
  private reader: Telemetry['getSnapshot'] | undefined;

  pause(): void {
    if (this.samples.length) this.gap = 'View was hidden';
  }

  record(
    snapshot: TelemetrySnapshot,
    at: number,
    elapsedMs: number,
    reader: Telemetry['getSnapshot'],
  ): TelemetryWindow {
    if (this.reader && this.reader !== reader) this.gap = 'Reader changed';
    this.reader = reader;
    const previous = this.samples.at(-1)?.snapshot;
    if (!this.gap && this.samples.length && !previous)
      this.gap = 'Read unavailable';
    if (
      !this.gap &&
      previous &&
      (snapshot.accepted < previous.accepted ||
        snapshot.delivered < previous.delivered ||
        Object.entries(previous.dropped).some(
          ([key, count]) =>
            snapshot.dropped[key as keyof TelemetrySnapshot['dropped']] < count,
        ))
    )
      this.gap = 'Counters reset';
    const seconds =
      (elapsedMs - (this.samples.at(-1)?.elapsedMs ?? elapsedMs)) / 1000;
    const interval =
      previous && !this.gap && seconds > 0
        ? {
            seconds,
            accepted: snapshot.accepted - previous.accepted,
            delivered: snapshot.delivered - previous.delivered,
            lost: losses(snapshot) - losses(previous),
          }
        : undefined;
    const sample: TelemetrySample = {
      sequence: ++this.sequence,
      at,
      elapsedMs,
      status: 'available',
      snapshot,
      gap: this.gap,
      interval,
    };
    this.gap = undefined;
    return this.append(sample);
  }

  unavailable(at: number, elapsedMs: number): TelemetryWindow {
    return this.append({
      sequence: ++this.sequence,
      at,
      elapsedMs,
      status: 'unavailable',
      gap: 'Read unavailable',
    });
  }

  private append(sample: TelemetrySample): TelemetryWindow {
    this.samples.push(sample);
    if (this.samples.length > TELEMETRY_HISTORY_LIMIT) {
      this.samples.shift();
      this.expired++;
    }
    const samples = [...this.samples];
    // The oldest retained point is a baseline; its predecessor is no longer inspectable.
    if (samples[0]) samples[0] = { ...samples[0], interval: undefined };
    const window = {
      samples,
      expired: this.expired,
      seconds: 0,
      accepted: 0,
      delivered: 0,
      lost: 0,
    };
    for (const { interval } of samples) {
      if (!interval) continue;
      window.seconds += interval.seconds;
      window.accepted += interval.accepted;
      window.delivered += interval.delivered;
      window.lost += interval.lost;
    }
    return window;
  }
}
