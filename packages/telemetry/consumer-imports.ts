import {
  emitTelemetryEvent,
  isDefaultTelemetryAttributeAllowed,
  maelstromTelemetryAttributes,
  noopTelemetrySink,
  sensitiveTelemetryFields,
  type TelemetrySink,
} from '@maelstrom-co/telemetry';

const sink: TelemetrySink = noopTelemetrySink;

emitTelemetryEvent(sink, {
  name: 'maelstrom.telemetry.event',
  severity: 'info',
  attributes: {
    [maelstromTelemetryAttributes['maelstrom.package'].name]:
      '@maelstrom-co/telemetry',
    [maelstromTelemetryAttributes['maelstrom.operation'].name]:
      'consumer-import-check',
  },
});

const consumerImportProof = {
  defaultAllowedOperation: isDefaultTelemetryAttributeAllowed(
    'maelstrom.operation',
  ),
  sensitiveSessionReason: sensitiveTelemetryFields.sessionId.reason,
  sink,
};

void consumerImportProof;
