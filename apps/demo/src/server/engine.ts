import { google } from '@ai-sdk/google';
import type { AssistantMessage } from '@maelstrom/engine';
import {
  createAISDKProvider,
  createEngine,
  createInMemoryHistoryStore,
} from '@maelstrom-co/engine';
import type { ChartRequest } from '@maelstrom-co/protocol';
import { createServerFn } from '@tanstack/react-start';

// Create the engine with Gemini provider and conversation history
const provider = createAISDKProvider(google('gemini-3-flash-preview'));
const historyStore = createInMemoryHistoryStore({
  sessionTtlMs: 60 * 60 * 1000, // 1 hour
  maxEntriesPerSession: 50,
});

const engine = createEngine({
  provider,
  timeout: 30000,
  retry: {
    maxAttempts: 2,
    initialDelayMs: 500,
  },
  history: {
    store: historyStore,
    contentLevel: 'full',
    maxEntries: 20,
  },
});

// Server function to process chart requests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const processChartRequest = createServerFn({ method: 'POST' })
  .inputValidator((data: ChartRequest) => data)
  .handler(async ({ data }) => {
    console.log('[Maelstrom Server] Processing request:', data.id);
    console.log(
      '[Maelstrom Server] Update reasons:',
      data.context.updateReasons,
    );

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

export const addAssistantMessage = createServerFn({ method: 'POST' })
  .inputValidator((data: AssistantMessage) => data)
  .handler(async ({ data }) => {
    console.log(
      '[Maelstrom Server] Adding assistant message:',
      data.message.slice(0, 50),
    );

    try {
      await engine.addAssistantMessage?.(data);
      return { success: true };
    } catch (error) {
      console.error('[Maelstrom Server] Error:', error);
      throw error;
    }
  });
