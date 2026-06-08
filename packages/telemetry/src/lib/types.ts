/**
 * Primitive attribute values allowed in Maelstrom telemetry payloads.
 *
 * This contract intentionally stays provider-neutral and SDK-free. It permits
 * `null` and `undefined` at the type level; privacy and default-emission
 * decisions are handled separately by the package privacy helpers.
 */
export type TelemetryAttributeValue =
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Immutable attribute bag shared by telemetry events, metrics, and timings.
 *
 * The contract does not infer safety from attribute names. Unknown fields still
 * require explicit privacy classification before they should be emitted by
 * default.
 */
export type TelemetryAttributes = Readonly<
  Record<string, TelemetryAttributeValue>
>;

/** Severity levels for discrete telemetry events. */
export type TelemetryEventSeverity = 'debug' | 'info' | 'warn' | 'error';

/**
 * Provider-neutral event payload emitted through a telemetry sink.
 *
 * This is a small contract payload, not an OpenTelemetry event API or exporter
 * envelope. Downstream adapters may translate it into OpenTelemetry, logs, or
 * vendor SDK calls.
 */
export interface TelemetryEvent {
  /** Curated or application-owned event name, typically namespaced like `maelstrom.*`. */
  readonly name: string;

  /** Optional event timestamp supplied by the caller when it already has one. */
  readonly timestamp?: number;

  /** Optional severity for discrete event-like signals. */
  readonly severity?: TelemetryEventSeverity;

  /** Optional immutable attribute bag attached to the event payload. */
  readonly attributes?: TelemetryAttributes;
}

/**
 * Supported metric instrument kinds for Maelstrom telemetry.
 *
 * These names describe the intended aggregate semantics of a metric payload.
 * They do not expose SDK registration, collection, or exporter lifecycle.
 */
export type TelemetryMetricKind =
  | 'counter'
  | 'histogram'
  | 'gauge'
  | 'up_down_counter';

/**
 * Units supported by the provider-neutral telemetry contract.
 *
 * Units live in metadata fields instead of being encoded into metric names.
 */
export type TelemetryUnit = 's' | 'ms' | 'count' | 'byte' | 'item';

/**
 * Provider-neutral metric payload recorded through a telemetry sink.
 *
 * Downstream adapters may map this into concrete SDK instruments, but this
 * package does not define registration, batching, or export behavior.
 */
export interface TelemetryMetric {
  /** Curated or application-owned metric name. Unit suffixes belong in `unit`, not the name. */
  readonly name: string;

  /** Intended aggregate semantics for the metric value. */
  readonly kind: TelemetryMetricKind;

  /** Numeric measurement recorded for the metric. */
  readonly value: number;

  /** Unit metadata carried separately from the metric name. */
  readonly unit: TelemetryUnit;

  /** Optional metric timestamp supplied by the caller when it already has one. */
  readonly timestamp?: number;

  /** Optional immutable attribute bag attached to the metric payload. */
  readonly attributes?: TelemetryAttributes;
}

/**
 * Provider-neutral duration payload recorded through a telemetry sink.
 *
 * This is a convenience contract for duration measurements. It intentionally
 * allows `'ms'` as well as `'s'`, even though some downstream OpenTelemetry
 * guidance prefers seconds for duration instruments.
 */
export interface TelemetryTiming {
  /** Curated or application-owned timing name. The unit belongs in `unit`, not the name. */
  readonly name: string;

  /** Duration value measured by the caller. */
  readonly duration: number;

  /** Duration unit metadata carried separately from the timing name. */
  readonly unit: 's' | 'ms';

  /** Optional timing timestamp supplied by the caller when it already has one. */
  readonly timestamp?: number;

  /** Optional immutable attribute bag attached to the timing payload. */
  readonly attributes?: TelemetryAttributes;
}

/**
 * Synchronous telemetry sink contract.
 *
 * Implementations must not require awaiting or Promise handling from callers.
 * Any queueing, retry, flushing, exporter, or network behavior belongs behind a
 * downstream adapter that implements this contract.
 */
export interface TelemetrySink {
  /** Records a discrete telemetry event synchronously and returns no result. */
  readonly emitEvent: (event: TelemetryEvent) => void;

  /** Records a metric synchronously and returns no result. */
  readonly recordMetric: (metric: TelemetryMetric) => void;

  /** Records a duration measurement synchronously and returns no result. */
  readonly recordTiming: (timing: TelemetryTiming) => void;
}
