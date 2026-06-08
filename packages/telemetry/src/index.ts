export type {
  TelemetryAttributeValue,
  TelemetryAttributes,
  TelemetryEventSeverity,
  TelemetryEvent,
  TelemetryMetricKind,
  TelemetryUnit,
  TelemetryMetric,
  TelemetryTiming,
  TelemetrySink,
} from './lib/types.js';
export {
  noopTelemetrySink,
  emitTelemetryEvent,
  recordTelemetryMetric,
  recordTelemetryTiming,
} from './lib/sink.js';
export type {
  TelemetryPrivacyClassification,
  TelemetryPrivacyMetadata,
} from './lib/privacy.js';
export {
  sensitiveTelemetryFields,
  isSensitiveTelemetryField,
  isDefaultTelemetryAttributeAllowed,
} from './lib/privacy.js';
export {
  maelstromTelemetryAttributes,
  maelstromTelemetryEvents,
  maelstromTelemetryMetrics,
  isMaelstromTelemetryName,
  isMaelstromTelemetryAttribute,
  isMaelstromTelemetryMetric,
} from './lib/vocabulary.js';
