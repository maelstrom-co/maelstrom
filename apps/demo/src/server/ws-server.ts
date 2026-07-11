/// <reference types="bun" />
/**
 * Text-only WebSocket engine server for the demo. Two modes, selected by the
 * HOSTED env var (set to "1" only inside the Cloudflare Container):
 *
 * - Local (HOSTED unset): one shared module-scope engine, Gemini, keyed by
 *   env vars — the `geminiText` adapter reads GOOGLE_API_KEY (or GEMINI_API_KEY
 *   as a fallback, via `@tanstack/ai-gemini`'s `getGeminiApiKeyFromEnv`). If
 *   it's missing the socket still connects and each request returns an
 *   `engine.error` rather than failing the connection.
 * - Hosted (HOSTED=1): one engine per WebSocket session, OpenAI, keyed by
 *   the visitor's own key. The first frame on every connection must be a
 *   demo-layer `playground.hello` handshake carrying { sessionId, apiKey };
 *   it is NOT part of the @maelstrom-co/protocol envelope union and is
 *   parsed here, before any frame reaches handleEnvelope.
 *
 * Both modes speak the same handleEnvelope/encodeEnvelope loop from
 * @maelstrom-co/engine and @maelstrom-co/protocol once a session has an
 * engine.
 */
import {
  createEngine,
  createInMemoryStore,
  type Engine,
  handleEnvelope,
  recoverCorrelation,
} from '@maelstrom-co/engine';
import {
  decodeClientEnvelope,
  EngineErrorMessage,
  encodeEnvelope,
  isErr,
} from '@maelstrom-co/protocol';
import { geminiText } from '@tanstack/ai-gemini';
// 2.1 branch: @tanstack/ai-openai@0.15.10 exports an explicit-key
// constructor (createOpenaiChat(model, apiKey, config?)) equivalent to
// ai-gemini's createGeminiChat, so no wrapper adapter file is needed.
import { createOpenaiChat } from '@tanstack/ai-openai';
import { isPlaygroundHello } from './playground-frames';
import { redactSecrets } from './redact';
import { SessionEngineManager } from './session-engine-manager';

const PORT = Number(process.env.WS_PORT ?? 3001);
const HOSTED = process.env.HOSTED === '1';
const MAX_SESSIONS = 50;
const IDLE_TTL_MS = 30 * 60 * 1000;
const HEARTBEAT_TYPES = new Set(['heartbeat.ping']);

const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

// --- Local mode: single shared engine (unchanged behavior) ---
let sharedEngine: Engine | null = null;
let sharedEngineInitError: string | null = null;
if (!HOSTED) {
  try {
    sharedEngine = createEngine({
      adapter: geminiText('gemini-3.1-flash-lite-preview'),
      maxRetries: 2,
      history: { store: createInMemoryStore(), maxEntries: 20 },
      prompt: { system: { rules: { append: SYSTEM_RULES } } },
    });
  } catch (err) {
    sharedEngineInitError = err instanceof Error ? err.message : String(err);
    console.warn(
      `[demo ws] engine unavailable: ${sharedEngineInitError}\n` +
        '  Set GOOGLE_API_KEY (or GEMINI_API_KEY). The socket still connects; ' +
        'chart requests will return an error until a key is set.',
    );
  }
}

// --- Hosted mode: per-session engine manager ---
const sessionEngines = HOSTED
  ? new SessionEngineManager({
      maxSessions: MAX_SESSIONS,
      idleTtlMs: IDLE_TTL_MS,
      systemRules: SYSTEM_RULES,
      createAdapter: (apiKey) => createOpenaiChat('gpt-4o-mini', apiKey),
    })
  : null;

interface SocketData {
  engine: Engine | null;
  helloReceived: boolean;
  sessionId: string | null;
  apiKey: string | null;
}

/**
 * The single choke point every outbound frame passes through. In HOSTED
 * mode the visitor's own key lives in ws.data for the lifetime of the
 * connection, so any wire string reaching here — a handleEnvelope reply, an
 * engine-null error frame, anything — gets scrubbed before it leaves the
 * process. Local mode is untouched: send() is a passthrough there, byte for
 * byte.
 */
function send(ws: Bun.ServerWebSocket<SocketData>, wire: string): void {
  if (HOSTED) {
    ws.send(redactSecrets(wire, ws.data.apiKey ?? undefined));
    return;
  }
  ws.send(wire);
}

const server = Bun.serve<SocketData>({
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      return srv.upgrade(req, {
        data: { engine: null, helloReceived: !HOSTED, sessionId: null, apiKey: null },
      })
        ? undefined
        : new Response('WebSocket upgrade failed', { status: 400 });
    }
    return new Response('Maelstrom demo engine server', { status: 200 });
  },
  websocket: {
    async message(ws, raw) {
      // Hosted mode: gate every connection on a playground.hello handshake
      // before any envelope traffic. Demo-layer frame — not the protocol
      // envelope union.
      if (HOSTED && !ws.data.helloReceived) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(raw));
        } catch {
          ws.close(1008, 'invalid handshake frame');
          return;
        }
        if (!isPlaygroundHello(parsed)) {
          ws.close(1008, 'expected playground.hello as the first frame');
          return;
        }
        if (!sessionEngines) {
          ws.close(1011, 'session engine unavailable');
          return;
        }
        try {
          ws.data.engine = sessionEngines.getOrCreate(parsed.sessionId, parsed.apiKey);
        } catch (err) {
          // redact() already stripped the exact key inside SessionEngineManager;
          // redactSecrets' sk-* pattern pass additionally catches masked/partial
          // echoes that don't match the stored key byte-for-byte, so this close
          // reason (sent to the client and logged) is doubly covered.
          const message = err instanceof Error ? err.message : 'engine unavailable';
          const safeMessage = redactSecrets(message, parsed.apiKey);
          console.warn(`[demo ws] session engine init failed: ${safeMessage}`);
          ws.close(1011, safeMessage);
          return;
        }
        ws.data.helloReceived = true;
        ws.data.sessionId = parsed.sessionId;
        ws.data.apiKey = parsed.apiKey;
        return;
      }

      // Malformed/non-JSON frames are not intercepted here — they fall
      // through to handleEnvelope below, whose own decodeClientEnvelope path
      // replies with a correlated engine.error instead of being dropped.
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        msg = undefined;
      }
      if (
        typeof msg === 'object' &&
        msg !== null &&
        HEARTBEAT_TYPES.has((msg as { type?: unknown }).type as string)
      ) {
        send(ws, JSON.stringify({ type: 'heartbeat.pong' }));
        return;
      }

      const engine = HOSTED ? ws.data.engine : sharedEngine;

      if (!engine) {
        // Mirrors the engine-null branch: decode enough of the client
        // envelope to reply with a correlated error instead of silently
        // dropping the frame.
        const decoded = decodeClientEnvelope(raw);
        const error = HOSTED
          ? 'session engine unavailable'
          : (sharedEngineInitError ?? 'engine unavailable');
        send(
          ws,
          encodeEnvelope(
            isErr(decoded)
              ? EngineErrorMessage({ error, ...recoverCorrelation(raw) })
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
      if (reply) send(ws, encodeEnvelope(reply));
    },
    close(ws) {
      if (ws.data.sessionId && sessionEngines) {
        sessionEngines.evict(ws.data.sessionId);
      }
    },
  },
});

console.log(
  `[demo ws] engine server listening on ws://localhost:${server.port}/ws ` +
    `(${HOSTED ? 'hosted/BYOK' : 'local/shared-engine'} mode)`,
);
