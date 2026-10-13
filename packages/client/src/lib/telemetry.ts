import type { Telemetry, TelemetryAttachment } from '@maelstrom-co/telemetry';
import { attachTelemetrySource } from '@maelstrom-co/telemetry/integration';
import type { DiagnosticChannel } from './diagnostic-channel.js';

/** Client-owned metadata observation, without connection or content capabilities. */
export interface ClientTelemetrySource {
  /** Stable observation source for this client lifetime. */
  readonly diagnostics: Pick<DiagnosticChannel, 'subscribeMetadata'>;
}

/**
 * Attaches local client operational facts without enabling remote diagnostics or content capture.
 * Attach before connecting. Repeated attachments share one subscription until the last release.
 * Release all references and await drained before the final application-owned flush and disposal.
 * Omitted or disabled telemetry does not subscribe.
 */
export function attachClientTelemetry(
  orchestrator: ClientTelemetrySource,
  telemetry?: Telemetry,
): TelemetryAttachment {
  return attachTelemetrySource(orchestrator, telemetry, 'client', (observer) =>
    orchestrator.diagnostics.subscribeMetadata(observer),
  );
}
