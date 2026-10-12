/// <reference types="bun" />
/**
 * Text-only WebSocket engine server for local dev. It uses one shared engine
 * built from the environment (see `./local-planner`): the LLM planner keyed by
 * OPENAI_API_KEY, or a Jev planner with MAELSTROM_PLANNER=jev or
 * jev-composed-pairs. Without a server key the LLM profile accepts the
 * browser's memory-only key through playground.hello and each connection
 * owns its engine.
 *
 * Shares the dispatchFrame core in `./dispatch` with the hosted transport
 * (`src/worker/session-do.ts`): every engine-bound frame goes to the
 * connection's Engine facade (`./engine-facade`, PROTOTYPE MAE-826).
 */
import { HEARTBEAT_PONG_FRAME } from '@maelstrom-co/connectors';
import type { Engine } from '@maelstrom-co/engine';
import { dispatchFrame } from './dispatch';
import { EngineFacade } from './engine-facade';
import { engineMetadataFrame } from './engine-model';
import { buildLocalEngine, buildSharedEngine } from './local-planner';
import { redactSecrets } from './redact';

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

export interface SocketData {
  helloReceived: boolean;
  reportMetadata?: boolean;
  browserApiKey?: string;
  browserEngine?: Engine | null;
  browserEngineInitError?: string | null;
  /** PROTOTYPE (MAE-826): this connection's Engine facade, built on first use. */
  facade?: EngineFacade;
}

export interface WebSocketHandlerDeps {
  readonly sharedEngine: Engine | null;
  readonly sharedEngineInitError: string | null;
  /** Server-held secrets, scrubbed from every outbound reply as defense in depth. */
  readonly secrets?: readonly string[];
  /** PROTOTYPE (MAE-825): server OpenAI key for the Agent Session loop. */
  readonly agentApiKey?: string;
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
  const {
    sharedEngine,
    sharedEngineInitError,
    secrets = [],
    agentApiKey,
  } = deps;

  return {
    open(ws) {
      if (ws.data.reportMetadata) ws.send(engineMetadataFrame());
    },
    async message(ws, raw) {
      const browserApiKey = ws.data.browserApiKey;
      const result = await dispatchFrame(raw, {
        helloReceived: ws.data.helloReceived,
        getEngine: () => sharedEngine ?? ws.data.browserEngine ?? null,
        // Bun never hibernates, so a connection here has either helloed
        // in this lifetime or never at all.
        wasHelloed: false,
        engineUnavailableReason:
          ws.data.browserEngineInitError ??
          sharedEngineInitError ??
          'engine unavailable',
        getFacade: (engine) => {
          if (ws.data.facade?.planner !== engine) {
            const apiKey = agentApiKey || ws.data.browserApiKey;
            ws.data.facade = new EngineFacade({
              planner: engine,
              ...(apiKey ? { apiKey } : {}),
              send: (wire) =>
                ws.send(
                  redactSecrets(wire, [
                    ...secrets,
                    ...(ws.data.browserApiKey ? [ws.data.browserApiKey] : []),
                  ]),
                ),
            });
          }
          return ws.data.facade;
        },
      });

      switch (result.kind) {
        case 'heartbeat':
          ws.send(HEARTBEAT_PONG_FRAME);
          return;
        case 'hello': {
          const built = buildSharedEngine(result.frame.apiKey, [
            ...secrets,
            result.frame.apiKey,
          ]);
          ws.data.browserApiKey = result.frame.apiKey;
          ws.data.browserEngine = built.engine;
          ws.data.browserEngineInitError = built.initError;
          ws.data.helloReceived = true;
          return;
        }
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
          ws.send(
            redactSecrets(result.wire, [
              ...secrets,
              ...(browserApiKey ? [browserApiKey] : []),
            ]),
          );
          return;
        case 'none':
          return;
      }
    },
  };
}

// Guarded so importing this module (e.g. from a test) builds nothing and
// binds no port: the engine and Bun.serve exist only when this file is the
// entrypoint.
if (import.meta.main) {
  const local = buildLocalEngine(process.env);
  const webSocketHandlers = createWebSocketHandlers({
    sharedEngine: local.engine,
    sharedEngineInitError: local.initError,
    secrets: local.secrets,
    agentApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  });
  const server = Bun.serve<SocketData>({
    port: PORT,
    fetch(req, srv) {
      let pathname: string;
      try {
        pathname = new URL(req.url).pathname;
      } catch {
        return new Response('Bad Request', { status: 400 });
      }
      if (pathname === '/ws') {
        return srv.upgrade(req, {
          data: {
            helloReceived: local.helloReceived,
            reportMetadata:
              new URL(req.url).searchParams.get('diagnostics') === '1',
          },
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
