/// <reference types="bun" />
/**
 * Minimal text-only WebSocket engine server for the demo.
 *
 * Speaks the `@maelstrom-co/protocol` envelope contract: every frame is decoded,
 * dispatched, and answered by `@maelstrom-co/engine`'s `handleEnvelope`, so this
 * host owns only socket plumbing — no wire shapes are hand-listed here.
 *
 * One shared engine (history is keyed by sessionId, so a single in-memory store
 * isolates sessions correctly). The engine requires GOOGLE_API_KEY (or
 * GEMINI_API_KEY) at construction; if it's missing the socket still connects and
 * each request returns an `engine.error` rather than failing the connection.
 *
 * Behavior differs from the previous hand-rolled handler in three ways, all by
 * delegating to `handleEnvelope`: history and assistant-message failures now
 * surface as `engine.error` (previously swallowed); assistant messages are now
 * recorded to history via `engine.handle` (previously a no-op); and an unknown
 * frame type gets an `engine.error` reply instead of silence.
 */
import {
  createEngine,
  createInMemoryStore,
  handleEnvelope,
  type Engine,
} from '@maelstrom-co/engine';
import {
  decodeClientEnvelope,
  encodeEnvelope,
  EngineErrorMessage,
  isErr,
} from '@maelstrom-co/protocol';
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
      // Engine failed to construct (e.g. missing key). Decode the frame purely
      // to recover correlation so the client's pending request is rejected
      // promptly instead of stranded to time out.
      if (engine === null) {
        const decoded = decodeClientEnvelope(raw);
        const error = engineInitError ?? 'engine unavailable';
        ws.send(
          encodeEnvelope(
            isErr(decoded)
              ? EngineErrorMessage({ error })
              : EngineErrorMessage({
                  error,
                  requestId: decoded.value.id,
                  sessionId: decoded.value.sessionId,
                }),
          ),
        );
        return;
      }

      const reply = await handleEnvelope(engine, raw);
      if (reply) ws.send(encodeEnvelope(reply));
    },
  },
});

console.log(
  `[demo ws] engine server listening on ws://localhost:${server.port}/ws`,
);
