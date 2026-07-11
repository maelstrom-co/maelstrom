import { WebSocketConnector } from '@maelstrom-co/client';

const STORAGE_KEY = 'maelstrom-playground-key';

export interface CreateDemoConnectorOptions {
  /** Defaults to reading localStorage directly; Task 4 supplies the real key-store-backed getter. */
  readonly getApiKey?: () => string | null;
}

/**
 * Creates a WebSocketConnector that connects to the demo engine WS server.
 * Local mode: connects to VITE_WS_URL ?? ws://localhost:3001, no handshake.
 * Hosted mode (VITE_HOSTED=1): connects same-origin and sends a
 * playground.hello handshake carrying the visitor's key before any
 * protocol traffic.
 */
export function createDemoConnector(options: CreateDemoConnectorOptions = {}) {
  const hosted = import.meta.env.VITE_HOSTED === '1';
  const getApiKey =
    options.getApiKey ??
    (() => (typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)));

  const wsUrl = hosted
    ? `wss://${window.location.host}`
    : (import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001');

  return new WebSocketConnector({
    url: `${wsUrl}/ws`,
    onOpen: hosted
      ? (send, sessionId) => {
          const apiKey = getApiKey();
          // No key yet: don't send a malformed handshake. The orchestrator
          // layer (Task 4) is responsible for prompting the key drawer
          // before the first Send/mic press when no key is set — this
          // function only guards against sending garbage over the wire.
          if (!apiKey) return;
          send(JSON.stringify({ type: 'playground.hello', sessionId, apiKey }));
        }
      : undefined,
  });
}
