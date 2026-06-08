import type { TelemetryPrivacyMetadata } from './privacy.js';
import type { TelemetryMetricKind, TelemetryUnit } from './types.js';

interface MaelstromTelemetryEntryMetadata {
  readonly name: string;
  readonly description: string;
  readonly privacy: TelemetryPrivacyMetadata;
}

interface MaelstromTelemetryMetricMetadata
  extends MaelstromTelemetryEntryMetadata {
  readonly kind: TelemetryMetricKind;
  readonly unit: TelemetryUnit;
}

function createPrivacyMetadata(
  classification: TelemetryPrivacyMetadata['classification'],
  defaultAllowed: boolean,
  reason: string,
): TelemetryPrivacyMetadata {
  return {
    classification,
    defaultAllowed,
    reason,
  };
}

function hasOwnTelemetryName<T extends Record<string, unknown>>(
  registry: T,
  name: string,
): name is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(registry, name);
}

/**
 * Curated Maelstrom attribute registry.
 *
 * Each entry carries the canonical attribute name, a short description, and
 * privacy metadata that callers can reuse when deciding default emission. These
 * are Maelstrom-owned names, not official OpenTelemetry semantic conventions.
 */
export const maelstromTelemetryAttributes = {
  'maelstrom.package': {
    name: 'maelstrom.package',
    description:
      'Published Maelstrom package name associated with the telemetry signal.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'Identifies the emitting Maelstrom package without user-derived content.',
    ),
  },
  'maelstrom.version': {
    name: 'maelstrom.version',
    description:
      'Published package version associated with the telemetry signal.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'Identifies the package version without carrying session-specific data.',
    ),
  },
  'maelstrom.layout_mode': {
    name: 'maelstrom.layout_mode',
    description:
      'Normalized layout mode active when the telemetry signal was emitted.',
    privacy: createPrivacyMetadata(
      'low_cardinality',
      true,
      'Enumerates a small set of layout modes for product diagnostics.',
    ),
  },
  'maelstrom.outcome': {
    name: 'maelstrom.outcome',
    description: 'Normalized outcome category for a completed Maelstrom operation.',
    privacy: createPrivacyMetadata(
      'low_cardinality',
      true,
      'Enumerates a small set of operation outcomes for aggregate analysis.',
    ),
  },
  'maelstrom.error_type': {
    name: 'maelstrom.error_type',
    description:
      'Normalized error category for failures, never a raw error message or stack.',
    privacy: createPrivacyMetadata(
      'low_cardinality',
      true,
      'Carries a normalized error category rather than a raw error message.',
    ),
  },
  'maelstrom.operation': {
    name: 'maelstrom.operation',
    description: 'Curated Maelstrom operation name for the current unit of work.',
    privacy: createPrivacyMetadata(
      'low_cardinality',
      true,
      'Operation names should come from a curated internal catalog rather than user input.',
    ),
  },
  'maelstrom.component': {
    name: 'maelstrom.component',
    description:
      'Stable Maelstrom component or subsystem identifier involved in the signal.',
    privacy: createPrivacyMetadata(
      'low_cardinality',
      true,
      'Component identifiers are bounded implementation labels, not free-form content.',
    ),
  },
} as const satisfies Readonly<Record<string, MaelstromTelemetryEntryMetadata>>;

/**
 * Curated Maelstrom event registry.
 *
 * Event names stay generic and namespaced so downstream adapters can map them
 * without depending on package-specific lifecycle catalogs. Custom `otel.*`
 * names are intentionally out of scope and reserved for OpenTelemetry.
 */
export const maelstromTelemetryEvents = {
  'maelstrom.telemetry.event': {
    name: 'maelstrom.telemetry.event',
    description: 'Generic Maelstrom telemetry event emitted through a telemetry sink.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'The curated event name itself carries no user content; attached attributes remain separately governed.',
    ),
  },
  'maelstrom.sink.error': {
    name: 'maelstrom.sink.error',
    description:
      'Telemetry sink or adapter reported an error while handling a signal.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'The event name is curated; sensitive error details must stay out of default attributes.',
    ),
  },
  'maelstrom.operation.completed': {
    name: 'maelstrom.operation.completed',
    description:
      'A Maelstrom operation finished and can be correlated with outcome metadata.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'Completion is a bounded lifecycle concept and the name itself contains no user data.',
    ),
  },
} as const satisfies Readonly<Record<string, MaelstromTelemetryEntryMetadata>>;

/**
 * Curated Maelstrom metric registry.
 *
 * Metric units live in metadata instead of the metric name so callers can keep
 * instrument names stable across sinks. Downstream adapters may translate these
 * entries into SDK-specific instruments, but this registry itself stays
 * provider-neutral.
 */
export const maelstromTelemetryMetrics = {
  'maelstrom.operation.duration': {
    name: 'maelstrom.operation.duration',
    description: 'Duration of a curated Maelstrom operation.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'The metric name is curated and unit metadata is carried separately from the name.',
    ),
    kind: 'histogram',
    unit: 'ms',
  },
  'maelstrom.operation.count': {
    name: 'maelstrom.operation.count',
    description: 'Count of curated Maelstrom operation executions.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'The metric name is curated and conveys only aggregate operation activity.',
    ),
    kind: 'counter',
    unit: 'count',
  },
  'maelstrom.queue.length': {
    name: 'maelstrom.queue.length',
    description: 'Current number of queued Maelstrom work items.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'Queue depth is an aggregate operational measure with no raw user content.',
    ),
    kind: 'gauge',
    unit: 'item',
  },
  'maelstrom.payload.size': {
    name: 'maelstrom.payload.size',
    description: 'Size of a curated Maelstrom telemetry payload or message body.',
    privacy: createPrivacyMetadata(
      'safe',
      true,
      'Payload size is measured as an aggregate byte count, not by inspecting or exporting raw content.',
    ),
    kind: 'histogram',
    unit: 'byte',
  },
} as const satisfies Readonly<Record<string, MaelstromTelemetryMetricMetadata>>;

/**
 * Returns `true` when `name` matches any curated Maelstrom attribute, event, or
 * metric name.
 *
 * Names outside the curated registries, including `otel.*`, return `false`.
 */
export function isMaelstromTelemetryName(name: string): boolean {
  return (
    isMaelstromTelemetryAttribute(name) ||
    hasOwnTelemetryName(maelstromTelemetryEvents, name) ||
    isMaelstromTelemetryMetric(name)
  );
}

/** Returns `true` when `name` matches a curated Maelstrom attribute name. */
export function isMaelstromTelemetryAttribute(name: string): boolean {
  return hasOwnTelemetryName(maelstromTelemetryAttributes, name);
}

/** Returns `true` when `name` matches a curated Maelstrom metric name. */
export function isMaelstromTelemetryMetric(name: string): boolean {
  return hasOwnTelemetryName(maelstromTelemetryMetrics, name);
}
