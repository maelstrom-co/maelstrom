import type { Telemetry, TelemetryAttachment } from '@maelstrom-co/telemetry';
import { attachTelemetrySource } from '@maelstrom-co/telemetry/integration';
import type { EngineMetadataObserver } from './diagnostics.js';

/** Server-local observation capability of an Engine lifetime. */
export interface EngineTelemetrySource {
  /** Observe metadata without enabling browser forwarding or content capture. */
  observeMetadata?(observer: EngineMetadataObserver): () => void;
}

/**
 * Attaches server-local operational facts in every environment, independently of browser forwarding.
 * Attach before requests. Repeated attachments share one subscription until the last release.
 * Release all references and await drained before the final application-owned flush and disposal.
 * Omitted or disabled telemetry, or an Engine without metadata observation, does not subscribe.
 */
export function attachEngineTelemetry(
  engine: EngineTelemetrySource,
  telemetry?: Telemetry,
): TelemetryAttachment {
  return attachTelemetrySource(
    engine,
    engine.observeMetadata ? telemetry : undefined,
    'engine',
    (observer) => engine.observeMetadata?.(observer) ?? (() => {}),
  );
}
