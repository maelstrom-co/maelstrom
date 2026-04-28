import type { ChartRequestMessage } from '@maelstrom-co/protocol';
import type { ChartRequest as ChartRequestOld } from '@maelstrom-co/protocol-old';

/**
 * Lifts a {@link ChartRequestMessage} envelope into the legacy
 * `ChartRequest` shape that `engine-old` still expects (with `id`,
 * `context.sessionId`, and `context.timestamp` on the payload).
 *
 * The single internal cast is the readonly→mutable bridge between the new
 * protocol's deeply-readonly types and `engine-old`'s mutable arrays — no
 * runtime conversion happens.
 *
 * **Delete this module once the demo migrates to the new engine** (i.e.
 * once `engine.handle(ChartRequestMessage)` is the dispatch entry point).
 * MAE-104 is the planned removal point.
 */
export function adaptEnvelopeToLegacyRequest(
  envelope: ChartRequestMessage,
): ChartRequestOld {
  const innerRequest = envelope.request;
  return {
    ...innerRequest,
    id: envelope.id,
    context: {
      ...innerRequest.context,
      sessionId: envelope.sessionId,
      timestamp: envelope.timestamp,
    },
  } as unknown as ChartRequestOld;
}
