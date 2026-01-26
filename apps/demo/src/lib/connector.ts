import type { ChartRequest, MaelstromResponse } from '@maelstrom/protocol';
import type { AssistantMessage, EngineConnector } from '@maelstrom/react';
import { addAssistantMessage, processChartRequest } from '../server/engine';

/**
 * Creates a connector that uses TanStack Start server functions.
 * This allows the client to call the server-side engine transparently.
 */
export function createServerFnConnector(): EngineConnector {
  return {
    async process(request: ChartRequest): Promise<MaelstromResponse> {
      const response = await processChartRequest({ data: request });
      return response as MaelstromResponse;
    },
    async addAssistantMessage(message: AssistantMessage): Promise<void> {
      await addAssistantMessage({ data: message });
    },
  };
}
