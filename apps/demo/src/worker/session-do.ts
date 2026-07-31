/**
 * Hosted BYOK transport: one Durable Object per session.
 *
 * Hibernation resets in-memory state and re-runs the constructor, so the
 * visitor's key cannot simply live in a field and be assumed present. It is
 * held per connection, dropped on hibernate, and re-requested over
 * `playground.rehello` — never written to storage or to
 * `serializeAttachment`, both of which the platform retains.
 *
 * Conversation history shares the engine's fate rather than the socket's:
 * it lives in the in-memory store `#engineFor` builds, so hibernation
 * discards it along with the key, and the rehello handshake restores only
 * the key. A visitor whose session hibernates keeps their connection and
 * their key but resumes with an empty history. That is a deliberate
 * consequence of persisting nothing — see the migration design doc; giving
 * history durability means writing conversation content to `ctx.storage`,
 * which is a separate decision from key custody and is not made here.
 *
 * ---
 *
 * **If you change the rehello handshake, key custody, the auto-response
 * pair, or anything about this object's lifecycle, run
 * `bun run verify:hibernation <deployed-host>` before shipping it.**
 *
 * The unit tests below hand-simulate a wake (a fresh instance plus a
 * pre-set attachment). That proves this file's logic is self-consistent; it
 * cannot prove the platform still behaves the way the logic assumes, and
 * `wrangler dev` never hibernates on production's schedule, so there is no
 * local path to the real thing. Breaking recovery does not fail any test —
 * it surfaces as sessions that die only after going idle, which reads as
 * intermittent and unreproducible.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  HEARTBEAT_PING_FRAME,
  HEARTBEAT_PONG_FRAME,
} from '@maelstrom-co/client';
import type { Engine } from '@maelstrom-co/engine';
import { encodeEnvelope } from '@maelstrom-co/protocol';
import { createOpenaiChat } from '@tanstack/ai-openai';
import {
  type DispatchResult,
  dispatchFrame,
  encodeEngineErrorReply,
} from '../server/dispatch';
import { createPlaygroundEngine } from '../server/engine-config';
import { resolvePreHelloDispatch } from '../server/playground-frames';
import { createRedactingLogger, redact, redactSecrets } from '../server/redact';

// gpt-4o-mini's own ceiling. Explicit and generous so a verbose layout
// response can never hit OpenAI's response.incomplete truncation, which
// @tanstack/ai currently swallows into a generic "structured output
// finalization produced no result".
const MAX_OUTPUT_TOKENS = 16384;

// Sent while a rehello this connection has not yet answered is outstanding.
// Deliberately NOT the "No API key set" copy a keyless visitor gets: the
// client answers a rehello either way (with a key, or with
// `playground.nokey`), so an unanswered one means the answer is still in
// flight, not that there is no key. Telling a visitor who has a perfectly
// good key that they have none would send them to the key drawer to fix
// something that isn't broken.
const REAUTHENTICATING_ERROR =
  'Session is re-authenticating after going idle — retry in a moment.';

/** Non-secret, survives hibernation. See the class doc for what must NOT go here. */
interface ConnectionMarker {
  readonly helloed: true;
  readonly sessionId: string;
}

/**
 * The Worker's bindings, generated from `wrangler.jsonc` into
 * `worker-configuration.d.ts` by the `typegen` target — deliberately not
 * hand-written. A hand-copied interface still compiles after a binding is
 * renamed in the config, so `env.SESSION_DO` becomes `undefined` at runtime
 * while typecheck stays green. Aliased rather than used directly only so the
 * name reads at the call sites.
 */
export type PlaygroundEnv = Env;

export class SessionDO extends DurableObject<PlaygroundEnv> {
  // Per connection, never per object: a DO can hold several sockets (many
  // tabs, or anyone who obtained the sessionId), and the key one connection
  // presented must not become the key another one spends.
  readonly #keys = new WeakMap<WebSocket, string>();
  // Object-scoped so reconnects and extra tabs share conversation history,
  // alongside the key it was built with so a mismatch rebuilds rather than
  // inherits. Rebuilding on a key mismatch discards the previous engine's
  // history, and that is the intended trade: a sessionId is correlation
  // data, not a secret, so a second socket presenting a DIFFERENT key may
  // well be a different person. Handing them the running engine would spend
  // the first visitor's key on their behalf and show them the first
  // visitor's conversation. Two tabs sharing one key — the common case —
  // match on `#engineKey` and share both engine and history as intended.
  #engine: Engine | null = null;
  #engineKey: string | null = null;
  // At most one frame PER SOCKET, cleared on that socket's hello and on its
  // close. Keyed by WebSocket (not a single object-scoped slot) because two
  // sockets on the same object can each wake from hibernation and need a
  // rehello independently — a single slot would silently drop the second
  // socket's triggering frame. Unbounded buffering would be a
  // memory-growth vector on a socket that never answers the rehello.
  readonly #pending = new Map<WebSocket, string>();
  // Connections that answered a rehello with `playground.nokey`. Suppresses
  // further rehellos on that socket — it has already said it has nothing to
  // send — so its traffic falls straight through to the same actionable
  // "No API key set" reply a never-helloed visitor gets, instead of
  // re-arming a handshake the client has explicitly declined. Cleared by a
  // real hello, so a visitor who pastes a key and reconnects recovers.
  readonly #declined = new WeakSet<WebSocket>();

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
        wasHelloed:
          key === null && marker?.helloed === true && !this.#declined.has(ws),
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
      // Safe to log precisely because #engineFor redacted it: without a
      // server-side line, a deployment where every visitor's engine fails
      // to build (a bad adapter upgrade, a provider outage) is invisible to
      // an operator — the only symptom is an error each visitor sees alone.
      console.error(`[session-do] engine construction failed: ${message}`);
      this.#send(ws, encodeEngineErrorReply(raw, message), key);
      return;
    }

    switch (result.kind) {
      case 'hello': {
        this.#keys.set(ws, result.frame.apiKey);
        // A key arrived, so any earlier decline is stale.
        this.#declined.delete(ws);
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
      case 'hello-declined': {
        // The client answered the rehello with "I have no key". Definitive,
        // so the buffered frame is never going to be replayable — answer it
        // now with the actionable error rather than holding it until this
        // socket closes, which would leave the visitor's request to die on
        // the client's correlator timeout with no diagnostic at all.
        this.#declined.add(ws);
        const pending = this.#pending.get(ws);
        this.#pending.delete(ws);
        if (pending !== undefined) this.#replyPreHello(ws, pending, key);
        return;
      }
      case 'rehello': {
        if (this.#pending.has(ws)) {
          // A rehello for this socket is already outstanding and this frame
          // raced its answer. Only one frame can be buffered, so this one
          // gets an immediate reply instead — an accurate "re-authenticating"
          // error, not the key-drawer copy, which would be a lie while the
          // client's hello is in flight. The ORIGINAL buffered frame stays
          // put and is replayed when that hello lands.
          this.#send(
            ws,
            encodeEngineErrorReply(raw, REAUTHENTICATING_ERROR),
            key,
          );
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
        this.#send(ws, result.wire, key);
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

  /**
   * Answers a frame that arrived without a usable key, the same way a
   * never-helloed visitor is answered: an actionable engine.error, or a
   * close for traffic that isn't even a protocol envelope.
   */
  #replyPreHello(ws: WebSocket, raw: string, key: string | null): void {
    const outcome = resolvePreHelloDispatch(raw);
    if (outcome.kind === 'close') {
      ws.close(1002, 'expected playground.hello as the first frame');
      return;
    }
    this.#send(ws, encodeEnvelope(outcome.message), key);
  }

  /**
   * Scrubs the connection's key from every outbound frame. The key is passed
   * in rather than read back from `#keys` here, because a dispatch that was
   * still awaiting the engine when this socket closed resumes AFTER
   * `#teardown` has already deleted the entry — re-reading would hand
   * `redactSecrets` an undefined key and silently drop the exact-match pass
   * on the one frame most likely to be carrying a provider error.
   */
  #send(ws: WebSocket, wire: string, key: string | null): void {
    ws.send(redactSecrets(wire, key ?? undefined));
  }

  #engineFor(apiKey: string): Engine {
    if (this.#engine && this.#engineKey === apiKey) return this.#engine;
    try {
      this.#engine = createPlaygroundEngine({
        adapter: createOpenaiChat('gpt-4o-mini', apiKey),
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
