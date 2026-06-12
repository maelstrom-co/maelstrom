/// <reference types="bun" />
/**
 * Minimal text-only WebSocket engine server for the demo.
 *
 * Speaks the `@maelstrom-co/client` `WebSocketConnector` contract:
 * - client sends `{ type: 'chart_request', id, sessionId, request }`
 * - server replies `{ type: 'engine.maelstrom.response', requestId, response }`
 * - `client.history.get` → `engine.history.response`
 *
 * One shared engine (history is keyed by sessionId, so a single in-memory store
 * isolates sessions correctly). The engine requires GOOGLE_API_KEY (or
 * GEMINI_API_KEY) at construction; if it's missing the socket still connects and
 * each chart request returns an error rather than failing the connection.
 */
import {
  createEngine,
  createInMemoryStore,
  type Engine,
} from '@maelstrom-co/engine';
import { isErr } from '@maelstrom-co/protocol';
import { geminiText } from '@tanstack/ai-gemini';

const PORT = Number(process.env.WS_PORT ?? 3001);

const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

let engine: Engine | null = null;
let engineInitError: string | null = null;
try {
  engine = createEngine({
    adapter: geminiText('gemini-3.1-flash-lite-preview'),
    maxRetries: 2,
    history: { store: createInMemoryStore(), maxEntries: 20 },
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
  });
} catch (err) {
  engineInitError = err instanceof Error ? err.message : String(err);
  console.warn(
    `[demo ws] engine unavailable: ${engineInitError}\n` +
      '  Set GOOGLE_API_KEY (or GEMINI_API_KEY). The socket still connects; ' +
      'chart requests will return an error until a key is set.',
  );
}

type WireMessage = {
  type?: string;
  id?: string;
  sessionId?: string;
  [key: string]: unknown;
};

const server = Bun.serve({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      return srv.upgrade(req)
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 400 });
    }
    return new Response('Maelstrom demo engine server', { status: 200 });
  },
  websocket: {
    async message(ws, raw) {
      let msg: WireMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      const fail = (error: string) =>
        ws.send(
          JSON.stringify({
            type: 'engine.error',
            sessionId: msg.sessionId,
            requestId: msg.id,
            error,
          }),
        );

      try {
        if (msg.type === 'chart_request') {
          if (!engine) {
            fail(engineInitError ?? 'engine unavailable');
            return;
          }
          // engine.handle validates the wire shape internally
          // (validateEngineMessage); the cast only satisfies the compile-time
          // signature.
          const result = await engine.handle(
            msg as unknown as Parameters<Engine['handle']>[0],
          );
          if (isErr(result)) {
            fail(result.error.message);
            return;
          }
          if (result.value.type === 'chart_response') {
            ws.send(
              JSON.stringify({
                type: 'engine.maelstrom.response',
                sessionId: msg.sessionId,
                requestId: result.value.id,
                response: result.value.response,
              }),
            );
          }
          return;
        }

        if (msg.type === 'client.history.get') {
          const entries =
            engine && msg.sessionId
              ? await engine
                  .getHistory(
                    msg.sessionId as Parameters<Engine['getHistory']>[0],
                  )
                  .then((r) => (isErr(r) ? [] : r.value))
              : [];
          ws.send(
            JSON.stringify({
              type: 'engine.history.response',
              requestId: msg.id,
              entries,
            }),
          );
          return;
        }

        // client.history.add_assistant_message and other client messages are
        // no-ops for the text-only demo.
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    },
  },
});

console.log(
  `[demo ws] engine server listening on ws://localhost:${server.port}/ws`,
);
