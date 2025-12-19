import type { EngineConnector } from '@maelstrom/react';
import type { ChartRequest, MaelstromResponse } from '@maelstrom/protocol';
import { processChartRequest } from '../server/engine';

/**
 * Creates a connector that uses TanStack Start server functions.
 * This allows the client to call the server-side engine transparently.
 */
export function createServerFnConnector(): EngineConnector {
  return {
    async process(request: ChartRequest): Promise<MaelstromResponse> {
      // Call the server function - TanStack Start handles the network layer
      const response = await processChartRequest({ data: request });
      return response as MaelstromResponse;
    },
  };
}
