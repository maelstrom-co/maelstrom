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
import { HEARTBEAT_PONG_FRAME } from '@maelstrom-co/client';
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
// createOpenaiChat takes an explicit key (createOpenaiChat(model, apiKey,
// config?)), equivalent to ai-gemini's createGeminiChat, so no wrapper
// adapter file is needed to hand each session its own visitor key.
import { createOpenaiChat } from '@tanstack/ai-openai';
import { classifyIncomingFrame, resolvePreHelloDispatch } from './playground-frames';
import { redactSecrets } from './redact';
import { SessionEngineManager } from './session-engine-manager';

const PORT = Number(process.env.WS_PORT ?? 3001);
const HOSTED = process.env.HOSTED === '1';
const MAX_SESSIONS = 50;
const IDLE_TTL_MS = 30 * 60 * 1000;

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
      // gpt-4o-mini's own ceiling (see @tanstack/ai-openai's model-meta).
      // Explicit and generous so a verbose layout response for a large
      // vessel/instance set can never hit OpenAI's `response.incomplete`
      // (max_output_tokens) truncation — @tanstack/ai's structured-output
      // finalization currently swallows that truncation into a generic
      // "structured output finalization produced no result" error instead
      // of surfacing it (confirmed against live gpt-4o-mini/0.40.0; upstream
      // bug, not fixed by this cap alone).
      modelOptions: { max_output_tokens: 16384 },
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
      // Parsed once and routed through classifyIncomingFrame so the
      // heartbeat check always runs before the hello gate below — see that
      // function's doc comment for why ordering matters. Non-JSON frames
      // classify as undefined, which the gate treats as 'hello-rejected'
      // pre-hello and as 'dispatch' post-hello (matching the previous
      // behavior: malformed post-hello frames fall through to
      // handleEnvelope, whose decodeClientEnvelope path replies with a
      // correlated engine.error instead of being dropped).
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        parsed = undefined;
      }

      // ws.data.helloReceived starts true in local mode (set at upgrade
      // time below), so this already resolves to 'dispatch' there without
      // any HOSTED check here.
      const decision = classifyIncomingFrame(parsed, ws.data.helloReceived);

      if (decision.kind === 'heartbeat') {
        send(ws, HEARTBEAT_PONG_FRAME);
        return;
      }

      if (decision.kind === 'hello-rejected') {
        // A keyless hosted visitor never sends playground.hello (there's no
        // key to offer), but the real client still emits protocol traffic
        // before then — a ResizeObserver-triggered chart_resize fires the
        // moment the socket opens, regardless of whether a key is set. See
        // resolvePreHelloDispatch's doc comment for why that frame gets a
        // reply instead of a close.
        const outcome = resolvePreHelloDispatch(raw);
        if (outcome.kind === 'close') {
          ws.close(1008, 'expected playground.hello as the first frame');
          return;
        }
        send(ws, encodeEnvelope(outcome.message));
        return;
      }

      if (decision.kind === 'hello') {
        const { frame } = decision;
        if (!sessionEngines) {
          ws.close(1011, 'session engine unavailable');
          return;
        }
        try {
          ws.data.engine = sessionEngines.getOrCreate(frame.sessionId, frame.apiKey);
        } catch (err) {
          // redact() inside SessionEngineManager already scrubs the message
          // (exact-key pass + sk-* pattern pass), so this close reason (sent
          // to the client and logged) needs no second pass here.
          const message = err instanceof Error ? err.message : 'engine unavailable';
          console.warn(`[demo ws] session engine init failed: ${message}`);
          ws.close(1011, message);
          return;
        }
        ws.data.helloReceived = true;
        ws.data.sessionId = frame.sessionId;
        ws.data.apiKey = frame.apiKey;
        return;
      }

      // Every dispatched frame in hosted mode proves the session is still
      // active — touch resets the idle TTL and LRU recency here, not just
      // at hello, so a session mid-conversation past the TTL window doesn't
      // get evicted out from under a socket that's still working.
      if (HOSTED && sessionEngines && ws.data.sessionId) {
        sessionEngines.touch(ws.data.sessionId);

        // touch() is a no-op once the session is already gone (LRU cap or
        // idle TTL evicted it before this frame arrived) — dispatching
        // against ws.data.engine at that point would serve the stale cached
        // engine forever, defeating the cap/TTL entirely. Close instead and
        // force a fresh hello/engine on reconnect.
        if (!sessionEngines.has(ws.data.sessionId)) {
          ws.close(1008, 'session evicted');
          return;
        }
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
