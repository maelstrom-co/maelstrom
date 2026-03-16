import { VoiceWebSocketConnector } from '@maelstrom-co/react-old';

const SESSION_ID = `demo-session-${Date.now()}`;

/**
 * Creates a VoiceWebSocketConnector that connects to the demo WS server.
 * The WS server runs on port 3001 alongside the TanStack Start dev server on 3000.
 */
export function createDemoConnector() {
  const wsUrl = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001';

  return new VoiceWebSocketConnector({
    url: `${wsUrl}/ws`,
    sessionId: SESSION_ID,
    language: 'en',
  });
}
