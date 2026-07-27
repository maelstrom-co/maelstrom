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
import { DEFAULT_HEARTBEAT_INTERVAL_MS, HEARTBEAT_PONG_FRAME } from '@maelstrom-co/client';
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
import { SessionCapacityError, SessionEngineManager } from './session-engine-manager';

const PORT = Number(process.env.WS_PORT ?? 3001);
const HOSTED = process.env.HOSTED === '1';
const MAX_SESSIONS = 50;
// Coupled to `sleepAfter` on the PlaygroundServer container in wrangler.jsonc
// — must never exceed it. The container's in-memory SessionEngineManager map
// (and every engine in it) is destroyed outright when the container sleeps,
// which happens well before this TTL if the two are allowed to drift apart.
// Keeping this at or below sleepAfter makes the TTL the binding constraint,
// so a session that outlives it was already gone for the more drastic reason.
const IDLE_TTL_MS = 10 * 60 * 1000;

const CAPACITY_CLOSE_REASON = 'Playground is at capacity — reload to start a new session.';

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
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
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

export interface SocketData {
  helloReceived: boolean;
  sessionId: string | null;
  apiKey: string | null;
}

export interface WebSocketHandlerDeps {
  readonly hosted: boolean;
  readonly sessionEngines: SessionEngineManager | null;
  readonly sharedEngine: Engine | null;
  readonly sharedEngineInitError: string | null;
}

/**
 * Builds the Bun WebSocket handler pair (`message`/`close`). Factored out of
 * the module-scope `Bun.serve(...)` call (guarded by `import.meta.main`
 * below) so the handshake/dispatch/eviction logic is importable and
 * unit-testable against an injected `SessionEngineManager` — without pulling
 * in `Bun.serve`'s own side effect of binding a real port.
 */
export function createWebSocketHandlers(
  deps: WebSocketHandlerDeps,
): Bun.WebSocketHandler<SocketData> {
  const { hosted, sessionEngines, sharedEngine, sharedEngineInitError } = deps;

  // The single choke point every outbound frame passes through. In hosted
  // mode the visitor's own key lives in ws.data for the lifetime of the
  // connection, so any wire string reaching here — a handleEnvelope reply, an
  // engine-null error frame, anything — gets scrubbed before it leaves the
  // process. Local mode is untouched: send() is a passthrough there, byte for
  // byte.
  function send(ws: Bun.ServerWebSocket<SocketData>, wire: string): void {
    if (hosted) {
      ws.send(redactSecrets(wire, ws.data.apiKey ?? undefined));
      return;
    }
    ws.send(wire);
  }

  return {
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
      // any hosted check here.
      const decision = classifyIncomingFrame(parsed, ws.data.helloReceived);

      if (decision.kind === 'heartbeat') {
        // touch(), not getOrCreate(): a heartbeat proves the tab is still
        // open, not that the visitor did anything, so it must not resurrect
        // an engine for a session nobody is using — only real dispatch
        // should do that. This is what makes it correct for the idle TTL to
        // now mean "no live tab" rather than "no typing": the close handler
        // below no longer evicts, so a heartbeating tab is the only signal
        // that keeps a session alive indefinitely.
        if (hosted && sessionEngines && ws.data.sessionId) {
          sessionEngines.touch(ws.data.sessionId);
        }
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
          // 1002 (protocol error), not 1008: the client flags 1008 as
          // non-retryable, and a reconnect here would legitimately succeed —
          // the fresh socket re-sends its handshake. Only closes the client
          // must not retry at all (capacity, in the hello and dispatch
          // branches below) earn 1008.
          ws.close(1002, 'expected playground.hello as the first frame');
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
          // Validated here (not just left for the first dispatch) so a bad
          // key closes the socket immediately with a decodable reason
          // instead of the visitor waiting on a silent first request. The
          // engine built here is discarded — dispatch below re-derives it
          // from sessionEngines on every frame instead of trusting a cached
          // reference, so this call's only job is the construction check.
          sessionEngines.getOrCreate(frame.sessionId, frame.apiKey);
        } catch (err) {
          if (err instanceof SessionCapacityError) {
            ws.close(1008, truncateCloseReason(CAPACITY_CLOSE_REASON));
            return;
          }
          // redact() inside SessionEngineManager already scrubs the message
          // (exact-key pass + sk-* pattern pass), so this close reason (sent
          // to the client and logged) needs no second pass here.
          const message = err instanceof Error ? err.message : 'engine unavailable';
          console.warn(`[demo ws] session engine init failed: ${message}`);
          ws.close(1011, truncateCloseReason(message));
          return;
        }
        ws.data.helloReceived = true;
        ws.data.sessionId = frame.sessionId;
        ws.data.apiKey = frame.apiKey;
        return;
      }

      // Re-derived fresh on every frame rather than trusting a cached
      // ws.data.engine: another connection can call getOrCreate with a
      // DIFFERENT apiKey for the same sessionId between this socket's frames
      // (SessionEngineManager evicts and rebuilds on a key mismatch), which
      // would otherwise leave this socket dispatching against an orphaned
      // engine reference forever. getOrCreate also touches TTL/LRU on a hit
      // and rebuilds on a miss, so it subsumes the old touch()/has() pair —
      // a session evicted by the idle TTL or a genuinely stale LRU pick gets
      // a fresh engine here instead of a hard close; losing conversation
      // history is the accepted degradation there, not a reason to close the
      // socket. The one exception is SessionCapacityError, handled below.
      let engine: Engine | null;
      if (hosted) {
        if (sessionEngines && ws.data.sessionId && ws.data.apiKey) {
          try {
            engine = sessionEngines.getOrCreate(ws.data.sessionId, ws.data.apiKey);
          } catch (err) {
            // Capacity is the one getOrCreate failure a retry cannot fix —
            // the container is full, so a reconnect just adds load. Every
            // other failure (construction error, bad key) falls through to
            // the engine-null branch below instead of closing the socket.
            if (err instanceof SessionCapacityError) {
              ws.close(1008, truncateCloseReason(CAPACITY_CLOSE_REASON));
              return;
            }
            engine = null;
          }
        } else {
          engine = null;
        }
      } else {
        engine = sharedEngine;
      }

      if (!engine) {
        // No engine to dispatch this frame to, so it can't go through
        // handleEnvelope below -- decode raw here too, so the reply is still
        // correlated (requestId/sessionId recovered) instead of the frame
        // being dropped silently.
        const decoded = decodeClientEnvelope(raw);
        const error = hosted
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
    close() {
      // A closed socket no longer evicts its session engine. WebSocketConnector
      // treats a non-1000 close as reconnect-worthy (a Cloudflare proxy drop,
      // a container sleep/restart) and rejoins on the SAME sessionId — evicting
      // here used to destroy the engine (and its conversation history) on
      // every one of those closes, so the very next `playground.hello` found
      // no engine and silently started a blank one. The idle TTL and the LRU
      // cap in SessionEngineManager already reclaim abandoned sessions; that
      // is what they are for.
    },
  };
}

const webSocketHandlers = createWebSocketHandlers({
  hosted: HOSTED,
  sessionEngines,
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
          data: { helloReceived: !HOSTED, sessionId: null, apiKey: null },
        })
          ? undefined
          : new Response('WebSocket upgrade failed', { status: 400 });
      }
      return new Response('Maelstrom demo engine server', { status: 200 });
    },
    websocket: webSocketHandlers,
  });

  console.log(
    `[demo ws] engine server listening on ws://localhost:${server.port}/ws ` +
      `(${HOSTED ? 'hosted/BYOK' : 'local/shared-engine'} mode)`,
  );
}
