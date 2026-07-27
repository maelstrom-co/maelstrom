/**
 * SPIKE — not wired into production. Measures whether the engine can run in
 * a Durable Object instead of a container, and what it costs to bundle.
 *
 * The import graph here deliberately mirrors ws-server.ts's: engine,
 * protocol codec, and BOTH provider adapters. A spike that imported only
 * what this file happens to call would report a bundle size production
 * could never hit.
 *
 * What this is testing, in order of how likely it is to kill the migration:
 *   1. Does the engine's dependency closure fit a Worker bundle at all?
 *      (3 MB gzip free / 10 MB paid, 64 MB pre-compression.)
 *   2. Does it evaluate inside the 1s startup budget?
 *   3. Does hibernation actually hold a session across an idle gap?
 */

import { DurableObject } from 'cloudflare:workers';
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
import { createOpenaiChat } from '@tanstack/ai-openai';

interface SpikeEnv {
  readonly SESSION_DO: DurableObjectNamespace;
  readonly SYSTEM_RULES?: string;
}

/**
 * One DO per session, so the whole reason SessionEngineManager exists —
 * LRU eviction, MAX_SESSIONS, SessionCapacityError, the two-heartbeat
 * liveness window — has no analogue here. The platform owns session
 * lifetime instead of us.
 */
export class SessionDO extends DurableObject<SpikeEnv> {
  // In-memory only, and deliberately NOT in ctx.storage: storage survives
  // hibernation, which would turn a session-only visitor key into one
  // written to disk. Same custody rule as the container, new surface that
  // makes violating it a one-line mistake.
  #engine: Engine | null = null;
  #apiKey: string | null = null;

  constructor(ctx: DurableObjectState, env: SpikeEnv) {
    super(ctx, env);
    // The runtime answers heartbeats itself, WITHOUT waking this object —
    // so the 30s client ping costs nothing and needs no server code. The
    // container needed that ping to stay alive; here it is purely the
    // client's own liveness check.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ type: 'heartbeat.ping' }),
        JSON.stringify({ type: 'heartbeat.pong' }),
      ),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // acceptWebSocket, not server.accept(): the latter pins this object in
    // memory for the life of the socket, which is exactly the container
    // cost model we are trying to leave.
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const raw = typeof message === 'string' ? message : '';

    // Handshake frame carrying the visitor's key. Kept in memory for as
    // long as this object stays resident; a hibernation wake re-requests
    // it rather than persisting it.
    const hello = parseHello(raw);
    if (hello) {
      this.#apiKey = hello.apiKey;
      this.#engine = null;
      ws.send(JSON.stringify({ type: 'playground.ready' }));
      return;
    }

    const decoded = decodeClientEnvelope(raw);
    if (isErr(decoded)) {
      const correlation = recoverCorrelation(raw);
      ws.send(
        encodeEnvelope(
          EngineErrorMessage({
            requestId: correlation.requestId,
            error: 'undecodable frame',
          }),
        ),
      );
      return;
    }

    const engine = this.#getEngine();
    if (!engine) {
      ws.send(
        encodeEnvelope(
          EngineErrorMessage({
            requestId: recoverCorrelation(raw).requestId,
            error: 'no session key',
          }),
        ),
      );
      return;
    }

    const reply = await handleEnvelope(engine, decoded.value);
    if (reply) ws.send(encodeEnvelope(reply));
  }

  override async webSocketClose(): Promise<void> {
    // Nothing to tear down: no TTL timer, no LRU bookkeeping, no eviction.
    // Dropping the reference is the whole cleanup path.
    this.#engine = null;
    this.#apiKey = null;
  }

  #getEngine(): Engine | null {
    if (this.#engine) return this.#engine;
    if (!this.#apiKey) return null;
    // Rebuilt lazily after a hibernation wake — a cost that now sits on the
    // request path rather than being amortised across a long-lived container
    // process, so it is one of the things worth measuring next.
    //
    // Same config shape as session-engine-manager.ts, except the history
    // store is per-object rather than per-entry in a shared map: one DO IS
    // one session, so there is nothing left to key by.
    this.#engine = createEngine({
      adapter: selectAdapter(this.#apiKey),
      maxRetries: 2,
      history: { store: createInMemoryStore(), maxEntries: 20 },
      prompt: { system: { rules: { append: this.env.SYSTEM_RULES ?? '' } } },
    });
    return this.#engine;
  }
}

/**
 * Both adapters are referenced so the bundle carries both, matching
 * ws-server.ts. Which one runs is irrelevant to the size question.
 */
function selectAdapter(apiKey: string) {
  return apiKey.startsWith('sk-')
    ? createOpenaiChat('gpt-4o-mini', apiKey)
    : geminiText('gemini-3.1-flash-lite-preview');
}

function parseHello(raw: string): { apiKey: string } | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string; apiKey?: string };
    if (parsed.type !== 'playground.hello') return null;
    if (typeof parsed.apiKey !== 'string' || parsed.apiKey.length === 0) {
      return null;
    }
    return { apiKey: parsed.apiKey };
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws')
      return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    // Session identity IS the object id — this one line replaces
    // worker/shard.ts's hash-based instance routing entirely.
    const session = url.searchParams.get('session') ?? 'anonymous';
    const id = env.SESSION_DO.idFromName(session);
    return env.SESSION_DO.get(id).fetch(request);
  },
};
