/// <reference types="bun" />
/**
 * Text-only WebSocket engine server for local dev: one shared module-scope
 * engine, Gemini, keyed by env vars — the `geminiText` adapter reads
 * GOOGLE_API_KEY (or GEMINI_API_KEY as a fallback, via `@tanstack/ai-gemini`'s
 * `getGeminiApiKeyFromEnv`). If it's missing the socket still connects and
 * each request returns an `engine.error` rather than failing the connection.
 *
 * Speaks the same handleEnvelope/encodeEnvelope loop from @maelstrom-co/engine
 * and @maelstrom-co/protocol as the hosted transport (`src/worker/session-do.ts`),
 * via the shared dispatchFrame core in `./dispatch`.
 */
import { HEARTBEAT_PONG_FRAME } from '@maelstrom-co/client';
import type { Engine } from '@maelstrom-co/engine';
import { geminiText } from '@tanstack/ai-gemini';
import { dispatchFrame } from './dispatch';
import { createPlaygroundEngine } from './engine-config';

const PORT = Number(process.env.WS_PORT ?? 3001);

// RFC 6455 caps a close reason at 123 UTF-8 bytes. Bun does not throw on a
// longer one -- it silently truncates by raw byte count, with no regard for
// character boundaries. A cut landing mid-multibyte-character produces
// invalid UTF-8, and Bun then reports close code 1003 ("invalid UTF8") to
// the client instead of the code this call site actually passed. Close
// codes are load-bearing here (WebSocketConnector branches reconnect
// behavior on them), so a truncation bug silently rewrites 1011 into 1003.
export function truncateCloseReason(reason: string, maxBytes = 123): string {
  const encoded = new TextEncoder().encode(reason);
  if (encoded.length <= maxBytes) return reason;

  // Slicing on UTF-16 code units (String.prototype.slice) has no idea
  // where UTF-8 character boundaries fall, so it is exactly the unsafe
  // approach this guards against. Instead: cut the encoded bytes at
  // maxBytes and back off one byte at a time until a fatal decoder accepts
  // the result -- that is the nearest valid character boundary at or
  // before the cap.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let end = maxBytes; end > 0; end--) {
    try {
      return decoder.decode(encoded.subarray(0, end));
    } catch {
      // Landed mid-character; back off and retry.
    }
  }
  return '';
}

let sharedEngine: Engine | null = null;
let sharedEngineInitError: string | null = null;
try {
  // No logger override: local dev keys the engine from env vars, so there is
  // no visitor secret for a redacting logger to scrub. See engine-config.ts.
  sharedEngine = createPlaygroundEngine({
    adapter: geminiText('gemini-3.1-flash-lite-preview'),
  });
} catch (err) {
  sharedEngineInitError = err instanceof Error ? err.message : String(err);
  console.warn(
    `[demo ws] engine unavailable: ${sharedEngineInitError}\n` +
      '  Set GOOGLE_API_KEY (or GEMINI_API_KEY). The socket still connects; ' +
      'chart requests will return an error until a key is set.',
  );
}

export interface SocketData {
  helloReceived: boolean;
}

export interface WebSocketHandlerDeps {
  readonly sharedEngine: Engine | null;
  readonly sharedEngineInitError: string | null;
}

/**
 * Builds the Bun WebSocket handler pair. Factored out of the module-scope
 * `Bun.serve(...)` call (guarded by `import.meta.main` below) so the
 * dispatch logic is importable and unit-testable — without pulling in
 * `Bun.serve`'s own side effect of binding a real port.
 */
export function createWebSocketHandlers(
  deps: WebSocketHandlerDeps,
): Bun.WebSocketHandler<SocketData> {
  const { sharedEngine, sharedEngineInitError } = deps;

  return {
    async message(ws, raw) {
      const result = await dispatchFrame(raw, {
        helloReceived: ws.data.helloReceived,
        getEngine: () => sharedEngine,
        // Bun never hibernates, so a connection here has either helloed
        // in this lifetime or never at all.
        wasHelloed: false,
        engineUnavailableReason: sharedEngineInitError ?? 'engine unavailable',
      });

      switch (result.kind) {
        case 'heartbeat':
          ws.send(HEARTBEAT_PONG_FRAME);
          return;
        case 'hello':
          // Unreachable locally: ws.data.helloReceived is always true below,
          // so classifyIncomingFrame never returns 'hello' here. Only the DO
          // transport (session-do.ts) has a real handshake to accept.
          return;
        case 'rehello':
          // Unreachable under Bun (wasHelloed is always false above); the
          // DO transport is the only producer.
          return;
        case 'hello-declined':
          // Unreachable under Bun: a decline only ever answers a rehello,
          // which this transport never sends.
          return;
        case 'close':
          ws.close(result.code, truncateCloseReason(result.reason));
          return;
        case 'reply':
          ws.send(result.wire);
          return;
        case 'none':
          return;
      }
    },
  };
}

const webSocketHandlers = createWebSocketHandlers({
  sharedEngine,
  sharedEngineInitError,
});

// Guarded so importing this module (e.g. from a test) builds the handlers
// above without binding a real port — Bun.serve is the only part of this
// file that needs the Bun runtime to actually be running as the entrypoint.
if (import.meta.main) {
  const server = Bun.serve<SocketData>({
    port: PORT,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === '/ws') {
        return srv.upgrade(req, {
          data: { helloReceived: true },
        })
          ? undefined
          : new Response('WebSocket upgrade failed', { status: 400 });
      }
      return new Response('Maelstrom demo engine server', { status: 200 });
    },
    websocket: webSocketHandlers,
  });

  console.log(
    `[demo ws] engine server listening on ws://localhost:${server.port}/ws`,
  );
}
