/// <reference types="@cloudflare/workers-types" />
/**
 * Hosted BYOK transport: one Durable Object per session.
 *
 * Hibernation resets in-memory state and re-runs the constructor, so the
 * visitor's key cannot simply live in a field and be assumed present. It is
 * held per connection, dropped on hibernate, and re-requested over
 * `playground.rehello` — never written to storage or to
 * `serializeAttachment`, both of which the platform retains.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  HEARTBEAT_PING_FRAME,
  HEARTBEAT_PONG_FRAME,
} from '@maelstrom-co/client';
import {
  createEngine,
  createInMemoryStore,
  type Engine,
} from '@maelstrom-co/engine';
import { encodeEnvelope } from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import {
  type DispatchResult,
  dispatchFrame,
  encodeEngineErrorReply,
} from '../server/dispatch';
import { resolvePreHelloDispatch } from '../server/playground-frames';
import { createRedactingLogger, redact, redactSecrets } from '../server/redact';

const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

// gpt-4o-mini's own ceiling. Explicit and generous so a verbose layout
// response can never hit OpenAI's response.incomplete truncation, which
// @tanstack/ai currently swallows into a generic "structured output
// finalization produced no result".
const MAX_OUTPUT_TOKENS = 16384;

/** Non-secret, survives hibernation. See the class doc for what must NOT go here. */
interface ConnectionMarker {
  readonly helloed: true;
  readonly sessionId: string;
}

export interface PlaygroundEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly ASSETS: Fetcher;
}

export class SessionDO extends DurableObject<PlaygroundEnv> {
  // Per connection, never per object: a DO can hold several sockets (many
  // tabs, or anyone who obtained the sessionId), and the key one connection
  // presented must not become the key another one spends.
  readonly #keys = new WeakMap<WebSocket, string>();
  // Object-scoped so reconnects and extra tabs share conversation history,
  // alongside the key it was built with so a mismatch rebuilds rather than
  // inherits.
  #engine: Engine | null = null;
  #engineKey: string | null = null;
  // At most one frame PER SOCKET, cleared on that socket's hello and on its
  // close. Keyed by WebSocket (not a single object-scoped slot) because two
  // sockets on the same object can each wake from hibernation and need a
  // rehello independently — a single slot would silently drop the second
  // socket's triggering frame. Unbounded buffering would be a
  // memory-growth vector on a socket that never answers the rehello.
  readonly #pending = new Map<WebSocket, string>();

  constructor(ctx: DurableObjectState, env: PlaygroundEnv) {
    super(ctx, env);
    // Answered by the runtime WITHOUT waking this object, so the client's
    // 30s liveness ping costs nothing here. Imported from
    // @maelstrom-co/client rather than restated here: auto-response only
    // fires on a byte-exact match, so a hardcoded literal that drifted from
    // the constants' own wire shape would silently stop being answered.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        HEARTBEAT_PING_FRAME,
        HEARTBEAT_PONG_FRAME,
      ),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    // acceptWebSocket, not server.accept(): the latter pins this object in
    // memory for the socket's life — the cost model this migration leaves.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const raw = typeof message === 'string' ? message : '';
    const key = this.#keys.get(ws) ?? null;
    const marker = ws.deserializeAttachment() as ConnectionMarker | null;

    let result: DispatchResult;
    try {
      result = await dispatchFrame(raw, {
        helloReceived: key !== null,
        // Lazy: the core invokes this only on its real-dispatch path, so a
        // heartbeat or handshake frame never triggers engine construction.
        getEngine: () => (key ? this.#engineFor(key) : null),
        wasHelloed: key === null && marker?.helloed === true,
        engineUnavailableReason: 'session engine unavailable',
      });
    } catch (err) {
      // #engineFor's construction failure (bad key, adapter rejection)
      // throws rather than returning null, so lazy `getEngine()` can throw
      // from inside dispatchFrame. Left uncaught, that propagates out of
      // this handler as an unhandled exception, which the Workers runtime
      // logs — and observability.logs.persist retains. #engineFor already
      // redacted the key out of err's message before it reached here.
      const message = err instanceof Error ? err.message : String(err);
      this.#send(ws, encodeEngineErrorReply(raw, message));
      return;
    }

    switch (result.kind) {
      case 'hello': {
        this.#keys.set(ws, result.frame.apiKey);
        ws.serializeAttachment({
          helloed: true,
          sessionId: result.frame.sessionId,
        } satisfies ConnectionMarker);
        // Replay whatever triggered the rehello, so the visitor's request is
        // answered rather than silently lost.
        const pending = this.#pending.get(ws);
        this.#pending.delete(ws);
        if (pending !== undefined) {
          await this.webSocketMessage(ws, pending);
        }
        return;
      }
      case 'rehello': {
        if (this.#pending.has(ws)) {
          // A previous rehello for this socket already went unanswered —
          // the visitor cannot (or will not) resupply a key. Sending
          // another bare rehello would repeat forever with no diagnostic,
          // so stop re-arming it: the ORIGINAL buffered frame stays put
          // (replayed if a real hello eventually arrives, dropped on
          // close), and every frame arriving in the meantime — including
          // this one — gets answered directly, the same way a
          // never-helloed visitor is answered.
          const outcome = resolvePreHelloDispatch(raw);
          if (outcome.kind === 'close') {
            ws.close(1002, 'expected playground.hello as the first frame');
          } else {
            this.#send(ws, encodeEnvelope(outcome.message));
          }
          return;
        }
        this.#pending.set(ws, raw);
        ws.send(JSON.stringify({ type: 'playground.rehello' }));
        return;
      }
      case 'close':
        ws.close(result.code, result.reason);
        return;
      case 'reply':
        this.#send(ws, result.wire);
        return;
      case 'heartbeat':
        // Defense in depth: setWebSocketAutoResponse answers a genuine ping
        // without ever reaching here, but if that ever misses, this keeps
        // the connection alive instead of the ping being silently dropped
        // into a reconnect loop.
        ws.send(HEARTBEAT_PONG_FRAME);
        return;
      case 'none':
        return;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.#teardown(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.#teardown(ws);
  }

  /**
   * Shared by both `webSocketClose` and `webSocketError`: workerd routes
   * some abnormal terminations to the latter, not the former, and either
   * one leaving `#pending`'s strong WebSocket reference behind — or
   * skipping the last-socket engine teardown — would be the same custody
   * and memory-growth problem regardless of which callback fired.
   */
  async #teardown(ws: WebSocket): Promise<void> {
    this.#keys.delete(ws);
    this.#pending.delete(ws);
    // getWebSockets() still includes the closing socket while this handler
    // is running (verified empirically against workerd via `wrangler dev`:
    // a probe log inside webSocketClose reported length=2/includes(ws)=true
    // on the first of two sockets closing, and length=1/includes(ws)=true
    // on the last) — so comparing to 0 would never fire and the engine
    // would leak past every session's last disconnect. <= 1 accounts for ws
    // itself still being counted.
    if (this.ctx.getWebSockets().length <= 1) {
      this.#engine = null;
      this.#engineKey = null;
    }
  }

  /** Scrubs the connection's key from every outbound frame. */
  #send(ws: WebSocket, wire: string): void {
    ws.send(redactSecrets(wire, this.#keys.get(ws)));
  }

  #engineFor(apiKey: string): Engine {
    if (this.#engine && this.#engineKey === apiKey) return this.#engine;
    try {
      this.#engine = createEngine({
        adapter: createOpenaiChat('gpt-4o-mini', apiKey),
        maxRetries: 2,
        history: { store: createInMemoryStore(), maxEntries: 20 },
        prompt: { system: { rules: { append: SYSTEM_RULES } } },
        // observability.logs.persist is on: without this the default
        // consoleLogger writes OpenAI's 401 key echo into retained logs.
        logger: createRedactingLogger(apiKey),
        modelOptions: { max_output_tokens: MAX_OUTPUT_TOKENS },
      });
    } catch (err) {
      // Never let a construction failure (bad key, adapter error) surface
      // the key — it may appear in a provider SDK's own error message. An
      // uncaught throw here would propagate through getEngine() →
      // dispatchFrame → webSocketMessage as an unhandled exception, which
      // the Workers runtime logs — and observability.logs.persist retains
      // it.
      throw redact(err, apiKey);
    }
    this.#engineKey = apiKey;
    return this.#engine;
  }
}
