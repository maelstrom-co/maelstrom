import { WebSocketConnector } from '@maelstrom-co/client';
import type { ChartRequestMessage } from '@maelstrom-co/protocol';
import { diagnosticCapture } from './diagnostic-capture';

export class DiagnosticConnector extends WebSocketConnector {
  override async process(message: ChartRequestMessage) {
    diagnosticCapture.engineRequest(message);
    const startedAt = performance.now();
    try {
      const response = await super.process(message);
      diagnosticCapture.engineResponse(
        message.id,
        response,
        performance.now() - startedAt,
      );
      return response;
    } catch (error) {
      diagnosticCapture.record('engine_error', {
        requestId: message.id,
        durationMs: performance.now() - startedAt,
      });
      throw error;
    }
  }
}
