import { WebSocketConnector } from '@maelstrom-co/client';
import { isHosted } from './hosted-mode';
import { playgroundKeyStore } from './playground-key-store';

export interface CreateDemoConnectorOptions {
  /**
   * Source of truth for the visitor's key. Defaults to reading
   * `playgroundKeyStore` — the same store the key drawer and custody UI
   * read/write — so every caller shares one key-custody source instead of
   * risking a getter that reads localStorage directly and misses a
   * session-only (`remember: false`) key that never touched storage.
   */
  readonly getApiKey?: () => string | null;
}

/**
 * Builds the WebSocket URL the demo connector opens. Pure so the
 * scheme-derivation invariant can be tested without a real `window`.
 *
 * Hosted mode connects same-origin, so the scheme must follow the page's
 * own protocol — a plain-HTTP origin cannot open a `wss://` socket
 * (ERR_SSL_PROTOCOL_ERROR) and an HTTPS origin cannot open a mixed-content
 * `ws://` one. Local mode is unaffected: it always uses `localWsUrl`.
 */
export function buildWsUrl(
  hosted: boolean,
  location: Pick<Location, 'protocol' | 'host'>,
  localWsUrl: string | undefined,
): string {
  if (hosted) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${location.host}/ws`;
  }
  return `${localWsUrl ?? 'ws://localhost:3001'}/ws`;
}

/**
 * Builds the `playground.hello` handshake frame's wire JSON. Pure and
 * exported so a test can assert the exact shape the server's
 * `isPlaygroundHello` guard expects, without needing a live WebSocket.
 */
export function buildPlaygroundHello(sessionId: string, apiKey: string): string {
  return JSON.stringify({ type: 'playground.hello', sessionId, apiKey });
}

/**
 * Creates a WebSocketConnector that connects to the demo engine WS server.
 * Local mode: connects to VITE_WS_URL ?? ws://localhost:3001, no handshake.
 * Hosted mode (VITE_HOSTED=1): connects same-origin and sends a
 * playground.hello handshake carrying the visitor's key before any
 * protocol traffic.
 */
export function createDemoConnector(options: CreateDemoConnectorOptions = {}) {
  const hosted = isHosted();
  const getApiKey = options.getApiKey ?? (() => playgroundKeyStore.state.apiKey);

  // window.location is only touched in the hosted branch (short-circuited
  // below) — local (non-hosted) mode must keep working in non-DOM test
  // environments. The `typeof window` guard covers hosted mode too: it's a
  // build-time flag, not proof `window` exists at the call site (e.g. SSR).
  const wsUrl = buildWsUrl(
    hosted,
    hosted && typeof window !== 'undefined'
      ? window.location
      : { protocol: '', host: '' },
    import.meta.env.VITE_WS_URL,
  );

  return new WebSocketConnector({
    url: wsUrl,
    // Cloudflare Containers only renew their idle timeout on socket traffic,
    // not on an open-but-silent connection — local dev has no such timeout,
    // so the heartbeat only runs in hosted mode.
    heartbeatIntervalMs: hosted ? 30_000 : undefined,
    onOpen: hosted
      ? (send, sessionId) => {
          const apiKey = getApiKey();
          // No key yet: don't send a malformed handshake. The app
          // composition root is responsible for prompting the key drawer
          // before the first Send/mic press when no key is set — this
          // function only guards against sending garbage over the wire.
          if (!apiKey) return;
          send(buildPlaygroundHello(sessionId, apiKey));
        }
      : undefined,
  });
}
