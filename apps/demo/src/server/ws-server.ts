/// <reference types="bun" />
/**
 * Text-only WebSocket engine server for local dev. It uses one shared engine
 * built from the environment (see `./local-planner`): the LLM planner keyed by
 * OPENAI_API_KEY, or a Jev planner with MAELSTROM_PLANNER=jev or
 * jev-composed-pairs. Without a server key the LLM profile accepts the
 * browser's memory-only key through playground.hello and each connection
 * owns its engine.
 *
 * Routes agent frames through one streaming connection handle. Legacy frames
 * keep the handleEnvelope/encodeEnvelope path shared with the hosted transport
 * (`src/worker/session-do.ts`) through `dispatchFrame`.
 */
import { HEARTBEAT_PONG_FRAME } from '@maelstrom-co/connectors';
import {
  createDiagnosticConnection,
  type DiagnosticConnection,
  type Engine,
  handleEnvelope,
} from '@maelstrom-co/engine';
import {
  decodeClientEnvelope,
  EngineErrorMessage,
  encodeEnvelope,
  isErr,
  SessionId,
} from '@maelstrom-co/protocol';
import { type AgentTransport, openAgentTransport } from './agent-transport';
import { dispatchFrame } from './dispatch';
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
  agent?: AgentTransport;
  sessionId?: SessionId;
  closed?: boolean;
  diagnostics?: DiagnosticConnection;
  helloReceived: boolean;
  reportMetadata?: boolean;
  browserApiKey?: string;
  browserEngine?: Engine | null;
  browserEngineInitError?: string | null;
}

export interface WebSocketHandlerDeps {
  readonly sharedEngine: Engine | null;
  readonly sharedEngineInitError: string | null;
  /** Connection-owned engine factory; the local E2E stand-in never uses provider transport. */
  readonly buildBrowserEngine?: typeof buildSharedEngine;
  /** Server-held secrets, scrubbed from every outbound reply as defense in depth. */
  readonly secrets?: readonly string[];
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
    buildBrowserEngine = buildSharedEngine,
  } = deps;

  return {
    open(ws) {
      if (ws.data.reportMetadata) ws.send(engineMetadataFrame());
    },
    close(ws) {
      ws.data.closed = true;
      ws.data.agent?.connection.close();
      ws.data.agent = undefined;
      ws.data.diagnostics?.dispose();
      ws.data.diagnostics = undefined;
      ws.data.browserApiKey = undefined;
      ws.data.browserEngine = undefined;
      ws.data.browserEngineInitError = undefined;
    },
    async message(ws, raw) {
      if (ws.data.closed) return;
      const browserApiKey = ws.data.browserApiKey;
      const result = await dispatchFrame(raw, {
        helloReceived: ws.data.helloReceived,
        handle: async (engine, frame) => {
          if (ws.data.closed) return null;
          const decoded = decodeClientEnvelope(frame);
          if (!isErr(decoded) && decoded.value.type === 'client.agent.input') {
            const envelope = decoded.value;
            const sessionId =
              ws.data.sessionId ??
              ws.data.agent?.sessionId ??
              envelope.sessionId;
            if (sessionId !== envelope.sessionId)
              return encodeEnvelope(
                EngineErrorMessage({
                  sessionId: envelope.sessionId,
                  requestId: envelope.id,
                  code: 'session_mismatch',
                  error: 'The input belongs to a different session.',
                }),
              );
            ws.data.agent ??= openAgentTransport(engine, sessionId, (wire) => {
              if (!ws.data.closed)
                ws.send(
                  redactSecrets(wire, [
                    ...secrets,
                    ...(ws.data.browserApiKey ? [ws.data.browserApiKey] : []),
                  ]),
                );
            });
            await ws.data.agent.connection.send(envelope.input);
            return null;
          }
          if (!ws.data.diagnostics && !isErr(decoded))
            ws.data.diagnostics = createDiagnosticConnection(engine, {
              enabled: ws.data.reportMetadata === true,
              sessionId: decoded.value.sessionId,
              send: (wire) => {
                ws.send(
                  redactSecrets(wire, [
                    ...secrets,
                    ...(ws.data.browserApiKey ? [ws.data.browserApiKey] : []),
                  ]),
                );
              },
            });
          if (ws.data.diagnostics) return ws.data.diagnostics.handle(frame);
          const reply = await handleEnvelope(engine, frame);
          return reply ? encodeEnvelope(reply) : null;
        },
        getEngine: () => sharedEngine ?? ws.data.browserEngine ?? null,
        // Bun never hibernates, so a connection here has either helloed
        // in this lifetime or never at all.
        wasHelloed: false,
        engineUnavailableReason:
          ws.data.browserEngineInitError ??
          sharedEngineInitError ??
          'engine unavailable',
      });

      if (ws.data.closed) return;
      switch (result.kind) {
        case 'heartbeat':
          ws.send(HEARTBEAT_PONG_FRAME);
          return;
        case 'hello': {
          ws.data.agent?.connection.close();
          ws.data.agent = undefined;
          ws.data.sessionId = SessionId(result.frame.sessionId);
          const built = buildBrowserEngine(result.frame.apiKey, [
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
