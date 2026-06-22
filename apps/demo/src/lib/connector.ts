import { WebSocketConnector } from '@maelstrom-co/client';

/**
 * Creates a WebSocketConnector that connects to the demo engine WS server.
 * The WS server runs on port 3001 alongside the TanStack Start dev server on 3000.
 */
export function createDemoConnector() {
  const wsUrl = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001';

  return new WebSocketConnector({
    url: `${wsUrl}/ws`,
  });
}
