import { DEFAULT_HEARTBEAT_INTERVAL_MS } from '@maelstrom-co/client';
import { SessionId } from '@maelstrom-co/protocol';
// A wire literal both sides must agree on byte-for-byte, so it is imported
// rather than restated here. playground-frames.ts is browser-safe (it pulls
// only @maelstrom-co/client and @maelstrom-co/protocol) despite living under
// src/server — it defines the contract, not a server implementation of it.
import { PLAYGROUND_NOKEY_FRAME } from '../server/playground-frames';
import { DiagnosticConnector } from './diagnostic-connector';
import { isHosted, usesBrowserKey } from './hosted-mode';
import { playgroundKeyStore } from './playground-key-store';

export interface CreateDemoConnectorOptions {
  /**
   * Source of truth for the visitor's key. Defaults to reading
   * `playgroundKeyStore` — the same store the key drawer and custody UI
   * read/write — so every caller shares one in-memory key-custody source.
   */
  readonly getApiKey?: () => string | null;
  /**
   * The session this connector belongs to, used in hosted mode to select
   * which SessionDO object identity the connection is routed to. Must be
   * the same id handed to `<Provider sessionId>`: the DO caches an engine
   * under this id, so routing a reconnect with a different one would land on
   * an object that has never seen the session. Omitted in local mode, where
   * nothing routes by session.
   *
   * Routing here is what makes resuming *possible*, not what guarantees it:
   * the engine and its conversation history are in-memory, so they survive a
   * reconnect only while the object stays resident. Hibernation discards
   * both, and the rehello handshake restores only the key — see
   * `worker/session-do.ts`.
   */
  readonly sessionId?: SessionId;
}

/**
 * Builds the WebSocket URL the demo connector opens. Pure so the
 * scheme-derivation invariant can be tested without a real `window`.
 *
 * Hosted mode connects same-origin, so the scheme must follow the page's
 * own protocol — a plain-HTTP origin cannot open a `wss://` socket
 * (ERR_SSL_PROTOCOL_ERROR) and an HTTPS origin cannot open a mixed-content
 * `ws://` one. Local mode is unaffected: it always uses `localWsUrl`.
 *
 * `routingSession`, when given, is appended as a `session` query param —
 * the hosted Worker in front of `/ws` reads it to select which SessionDO
 * object identity (`env.SESSION_DO.idFromName(session)`) the connection is
 * routed to, so a session's socket always reaches the Durable Object
 * holding its engine and conversation history instead of an unrelated one.
 * Omitted in local mode: nothing sits in front of local dev's `ws-server.ts`
 * to route for.
 */
export function buildWsUrl(
  hosted: boolean,
  location: Pick<Location, 'protocol' | 'host'>,
  localWsUrl: string | undefined,
  routingSession?: string,
): string {
  if (hosted) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const query = routingSession
      ? `?session=${encodeURIComponent(routingSession)}`
      : '';
    return `${scheme}://${location.host}/ws${query}`;
  }
  return `${localWsUrl ?? 'ws://localhost:3001'}/ws`;
}

/**
 * Builds the `playground.hello` handshake frame's wire JSON. Pure and
 * exported so a test can assert the exact shape the server's
 * `isPlaygroundHello` guard expects, without needing a live WebSocket.
 */
export function buildPlaygroundHello(
  sessionId: string,
  apiKey: string,
): string {
  return JSON.stringify({ type: 'playground.hello', sessionId, apiKey });
}

/**
 * True if `raw` is the DO's `playground.rehello` wire frame. Parses first
 * and checks the discriminant field — mirroring `@maelstrom-co/client`'s
 * `isHeartbeatPongFrame` — rather than comparing against the frame's exact
 * serialized text: if `SessionDO` ever adds a field to this frame (a reason
 * code, a session id), an exact-string comparison would silently stop
 * matching, and a visitor's session would never recover from hibernation.
 * A non-JSON `raw` returns `false` rather than throwing, so `onFrame` always
 * falls through to envelope decoding for traffic it doesn't own.
 */
function isRehelloFrame(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { type?: unknown }).type === 'playground.rehello'
  );
}

/**
 * Creates a WebSocketConnector that connects to the demo engine WS server.
 * Local mode connects to VITE_WS_URL ?? ws://localhost:3001. When its server
 * has no OpenAI key, it sends the same playground.hello handshake as hosted
 * mode; hosted mode also switches the URL to the same-origin Worker.
 */
export function createDemoConnector(options: CreateDemoConnectorOptions = {}) {
  const hosted = isHosted();
  const browserKeyMode = usesBrowserKey();
  const getApiKey =
    options.getApiKey ?? (() => playgroundKeyStore.state.apiKey);

  // Baked into wsUrl below rather than resolved per attempt, because
  // WebSocketConnector reuses its constructed URL for every reconnect — so
  // the DO identity stays pinned for the life of the session. Falling back
  // to a fresh id keeps a caller that omits sessionId routable, but such a
  // connector cannot resume a session across its own replacement.
  const routingSession = hosted
    ? (options.sessionId ?? SessionId())
    : undefined;

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
    routingSession,
  );

  return new DiagnosticConnector({
    url: wsUrl,
    // Client-side liveness detection: the DO answers each ping via
    // setWebSocketAutoResponse without waking the object, so this costs
    // nothing server-side and just lets WebSocketConnector notice a dead
    // connection (a proxy drop, a network change) and reconnect. Local dev
    // has no proxy in front of it to drop the socket, so the heartbeat only
    // runs in hosted mode.
    heartbeatIntervalMs: hosted ? DEFAULT_HEARTBEAT_INTERVAL_MS : undefined,
    onOpen: browserKeyMode
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
    // The DO drops the visitor's key when it hibernates — deliberately, so
    // the key is never persisted anywhere — and asks for it again on wake.
    // The socket stayed open throughout, so onOpen never fires and this is
    // the only path that can restore the session.
    onFrame: hosted
      ? (raw, send, sessionId) => {
          if (!isRehelloFrame(raw)) return false;
          const apiKey = getApiKey();
          // Always answer, even empty-handed. The server is holding the
          // frame that triggered this rehello and cannot tell a silent
          // client from a slow one: staying quiet strands that request
          // until the correlator times out with no diagnostic, whereas an
          // explicit decline lets the server answer it immediately with the
          // "open the key drawer" error the visitor can actually act on.
          send(
            apiKey
              ? buildPlaygroundHello(sessionId, apiKey)
              : PLAYGROUND_NOKEY_FRAME,
          );
          return true;
        }
      : undefined,
  });
}
