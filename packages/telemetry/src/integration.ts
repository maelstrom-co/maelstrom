/** Producer integration helpers. Applications use their producer's attachment interface. */
export { attachTelemetrySource } from './attach-source.js';
export { projectDiagnosticMetadata } from './diagnostic-metadata.js';
export { MetadataObservers } from './metadata-observers.js';
export { type OperationalKind, operationalKinds } from './operational-kinds.js';
export type {
  ObservationArguments,
  ObservationMetadata,
  OperationalMetadata,
  OperationalOutcome,
} from './operational-metadata.js';
export type { TelemetryMetadataObserver } from './types.js';
