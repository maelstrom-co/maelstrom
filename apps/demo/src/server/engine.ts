import { google } from '@ai-sdk/google';
import { createAISDKProvider, createEngine } from '@maelstrom/engine';
import type { ChartRequest } from '@maelstrom/protocol';
import { createServerFn } from '@tanstack/react-start';

// Create the engine with Gemini provider
const provider = createAISDKProvider(google('gemini-3-flash-preview'));
const engine = createEngine({
  provider,
  timeout: 30000,
  retry: {
    maxAttempts: 2,
    initialDelayMs: 500,
  },
});

// Server function to process chart requests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const processChartRequest = createServerFn({ method: 'POST' })
  .inputValidator((data: ChartRequest) => data)
  .handler(async ({ data }) => {
    console.log('[Maelstrom Server] Processing request:', data.id);
    console.log('[Maelstrom Server] User intent:', data.context.userIntent);

    try {
      const response = await engine.process(data);
      console.log('[Maelstrom Server] Rationale:', response.rationale);
      console.log('[Maelstrom Server] User Message:', response.userMessage);
      // Cast to any to bypass TanStack Start's strict Record<string, {}> constraint
      // biome-ignore lint/suspicious/noExplicitAny: TanStack Start type constraint workaround
      return response as any;
    } catch (error) {
      console.error('[Maelstrom Server] Error:', error);
      throw error;
    }
  });
