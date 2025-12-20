import { createServerFn } from "@tanstack/react-start";
import { google } from "@ai-sdk/google";
import { createEngine, createAISDKProvider } from "@maelstrom/engine";
import type { ChartRequest } from "@maelstrom/protocol";

// Create the engine with Gemini provider
const provider = createAISDKProvider(google("gemini-3-flash-preview"));
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
export const processChartRequest = createServerFn({ method: "POST" })
  .inputValidator((data: ChartRequest) => data)
  .handler(async ({ data }) => {
    console.log("[Maelstrom Server] Processing request:", data.id);
    console.log("[Maelstrom Server] User intent:", data.context.userIntent);

    try {
      const response = await engine.process(data);
      console.log("[Maelstrom Server] Response:", response.rationale);
      // Cast to any to bypass TanStack Start's strict Record<string, {}> constraint
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return response as any;
    } catch (error) {
      console.error("[Maelstrom Server] Error:", error);
      throw error;
    }
  });
