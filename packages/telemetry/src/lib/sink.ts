import type {
  TelemetryEvent,
  TelemetryMetric,
  TelemetrySink,
  TelemetryTiming,
} from './types.js';

/**
 * Reusable sink that intentionally ignores every telemetry payload.
 *
 * This value is inert by design: each method is synchronous, returns
 * `undefined`, and performs no export, buffering, retry, or logging work.
 */
export const noopTelemetrySink: TelemetrySink = {
  emitEvent() {},
  recordMetric() {},
  recordTiming() {},
};

/**
 * Emits an event when a sink is present; otherwise does nothing.
 *
 * The helper returns `undefined` in all cases, does not clone or sanitize the
 * payload, and does not catch errors thrown by a provided sink implementation.
 * Adapters that need async or resilient behavior must hide that behind the
 * synchronous {@link TelemetrySink} contract.
 */
export function emitTelemetryEvent(
  sink: TelemetrySink | undefined,
  event: TelemetryEvent,
): undefined {
  if (sink === undefined) {
    return undefined;
  }

  sink.emitEvent(event);

  return undefined;
}

/**
 * Records a metric when a sink is present; otherwise does nothing.
 *
 * The helper returns `undefined` in all cases and forwards the original metric
 * object identity unchanged when a sink exists.
 */
export function recordTelemetryMetric(
  sink: TelemetrySink | undefined,
  metric: TelemetryMetric,
): undefined {
  if (sink === undefined) {
    return undefined;
  }

  sink.recordMetric(metric);

  return undefined;
}

/**
 * Records a timing when a sink is present; otherwise does nothing.
 *
 * The helper returns `undefined` in all cases and keeps the provider-neutral
 * contract separate from downstream exporter or SDK concerns.
 */
export function recordTelemetryTiming(
  sink: TelemetrySink | undefined,
  timing: TelemetryTiming,
): undefined {
  if (sink === undefined) {
    return undefined;
  }

  sink.recordTiming(timing);

  return undefined;
}
