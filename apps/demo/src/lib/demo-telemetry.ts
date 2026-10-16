import { attachClientTelemetry } from '@maelstrom-co/client';
import type { MaelstromExtensionContext } from '@maelstrom-co/react';
import {
  createTelemetry,
  noopTelemetry,
  type TelemetryAttachment,
} from '@maelstrom-co/telemetry';

export function createDemoTelemetry() {
  const telemetry =
    typeof window === 'undefined'
      ? noopTelemetry
      : createTelemetry({
          sink(records) {
            console.debug({ event: 'demo.telemetry.batch', records });
          },
        });
  const attachments = new Set<TelemetryAttachment>();
  const registrations = new Set<() => void>();
  let stopped = false;

  const extension = (context: MaelstromExtensionContext) => {
    if (stopped || !telemetry.enabled) return {};
    if (!context.onOrchestrator)
      throw new Error(
        'Demo telemetry requires Provider lifecycle observation.',
      );
    registrations.add(
      context.onOrchestrator((client) => {
        const attachment = attachClientTelemetry(client, telemetry);
        attachments.add(attachment);
        void attachment.drained.then(() => attachments.delete(attachment));
        return attachment.release;
      }),
    );
    return {};
  };

  async function dispose() {
    stopped = true;
    for (const unregister of registrations) unregister();
    registrations.clear();
    const pending = [...attachments];
    for (const attachment of pending) attachment.release();
    await Promise.all(pending.map((attachment) => attachment.drained));
    await telemetry.flush();
    telemetry.dispose();
  }

  return { telemetry, extension, dispose };
}
