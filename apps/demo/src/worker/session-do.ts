/**
 * Hosted BYOK transport: one Durable Object per session.
 *
 * Hibernation resets in-memory state and re-runs the constructor, so the
 * visitor's key cannot simply live in a field and be assumed present. It is
 * held per connection, dropped on hibernate, and re-requested over
 * `playground.rehello` — never written to storage or to
 * `serializeAttachment`, both of which the platform retains. That custody is
 * owned by the Effect services under `./session/`:
 *
 *   - `Connections` holds keys per connection, tracks rehello declines, and
 *     buffers at most one triggering frame per socket.
 *   - `Engines` owns the object-scoped engine cache and its last-socket
 *     teardown rule.
 *   - `EngineFactory` is the typed-error boundary: a failed engine build can
 *     only surface as an `EngineBuildError` whose message was already
 *     scrubbed of the key that built it.
 *
 * Conversation history shares the engine's fate rather than the socket's:
 * it lives in the engine's in-memory store, so hibernation discards it along
 * with the key, and the rehello handshake restores only the key. A visitor
 * whose session hibernates keeps their connection and their key but resumes
 * with an empty history. That is a deliberate consequence of persisting
 * nothing — see the migration design doc; giving history durability means
 * writing conversation content to `ctx.storage`, which is a separate
 * decision from key custody and is not made here.
 *
 * ---
 *
 * **If you change the rehello handshake, key custody, the auto-response
 * pair, or anything about this object's lifecycle, run
 * `bun run verify:hibernation <deployed-host>` before shipping it.**
 *
 * The unit tests hand-simulate a wake (a fresh instance plus a pre-set
 * attachment). That proves this file's logic is self-consistent; it cannot
 * prove the platform still behaves the way the logic assumes, and
 * `wrangler dev` never hibernates on production's schedule, so there is no
 * local path to the real thing. Breaking recovery does not fail any test —
 * it surfaces as sessions that die only after going idle, which reads as
 * intermittent and unreproducible.
 */
import { DurableObject } from 'cloudflare:workers';
import { readWorkspaceRun } from '@maelstrom-co/agui/contract';
import {
  AguiWorkspaceSession,
  rejectWorkspaceRun,
} from '@maelstrom-co/agui/server';
import {
  HEARTBEAT_PING_FRAME,
  HEARTBEAT_PONG_FRAME,
} from '@maelstrom-co/connectors';
import { encodeEnvelope } from '@maelstrom-co/protocol';
import { Effect, Layer, ManagedRuntime } from 'effect';
import * as Result from 'effect/Result';
import { dispatchFrame, encodeEngineErrorReply } from '../server/dispatch';
import { engineMetadataFrame } from '../server/engine-model';
import { resolvePreHelloDispatch } from '../server/playground-frames';
import { redactSecrets } from '../server/redact';
import { Connections, ConnectionsLive } from './session/connections';
import { EngineBuildError, EngineFactoryLive } from './session/engine-factory';
import { Engines, EnginesLive } from './session/engines';

// Sent while a rehello this connection has not yet answered is outstanding.
// Deliberately NOT the "No API key set" copy a keyless visitor gets: the
// client answers a rehello either way (with a key, or with
// `playground.nokey`), so an unanswered one means the answer is still in
// flight, not that there is no key. Telling a visitor who has a perfectly
// good key that they have none would send them to the key drawer to fix
// something that isn't broken.
const REAUTHENTICATING_ERROR =
  'Session is re-authenticating after going idle — retry in a moment.';

/**
 * The Worker's bindings come from `Cloudflare.InferEnv` on the Alchemy Worker
 * declaration. A hand-copied interface could still compile after a binding is
 * renamed, leaving `env.SESSION_DO` undefined at runtime. This alias only
 * gives the inferred type a domain-specific name at call sites.
 */
export type PlaygroundEnv = Env;

// Composition root for this DO's Effect runtime: per-connection custody plus
// the engine cache over the redacting factory. These are blueprints, not
// shared state — each instance's ManagedRuntime.make below performs its own
// layer build with fresh service closures, which is what makes wake-from-
// hibernation reconstruction (constructor re-runs, memory empty) work.
const enginesLive = Layer.provide(EnginesLive, EngineFactoryLive);
const sessionLayer = Layer.mergeAll(ConnectionsLive, enginesLive);

export class SessionDO extends DurableObject<PlaygroundEnv> {
  readonly #runtime = ManagedRuntime.make(sessionLayer);
  readonly #workspaces = new WeakMap<WebSocket, AguiWorkspaceSession>();

  constructor(ctx: DurableObjectState, env: PlaygroundEnv) {
    super(ctx, env);
    // Answered by the runtime WITHOUT waking this object, so the client's
    // 30s liveness ping costs nothing here. Imported from
    // @maelstrom-co/connectors rather than restated here: auto-response only
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
    if (new URL(request.url).searchParams.get('diagnostics') === '1') {
      server.send(engineMetadataFrame());
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const raw = typeof message === 'string' ? message : '';
    // runPromise awaits the layer build on first use, so a callback racing
    // composition still runs only once the services exist.
    return this.#runtime.runPromise(this.#onMessage(ws, raw));
  }

  override webSocketClose(ws: WebSocket): Promise<void> {
    return this.#runtime.runPromise(this.#teardown(ws));
  }

  override webSocketError(ws: WebSocket): Promise<void> {
    return this.#runtime.runPromise(this.#teardown(ws));
  }

  /**
   * Shared by both `webSocketClose` and `webSocketError`: workerd routes some
   * abnormal terminations to the latter rather than the former, and either
   * one skipping the last-socket engine teardown would be the same key-
   * custody leak regardless of which callback fired.
   */
  #teardown(ws: WebSocket): Effect.Effect<void, never, Connections | Engines> {
    return Effect.gen({ self: this }, function* () {
      const connections = yield* Connections;
      const engines = yield* Engines;

      connections.forget(ws);
      this.#workspaces.get(ws)?.close();
      this.#workspaces.delete(ws);
      // getWebSockets() still includes the closing socket while this handler
      // is running (verified empirically against workerd via `wrangler dev`:
      // a probe log inside webSocketClose reported length=2/includes(ws)=true
      // on the first of two sockets closing, and length=1/includes(ws)=true
      // on the last) — so comparing to 0 would never fire and the engine
      // would leak past every session's last disconnect. <= 1 accounts for ws
      // itself still being counted.
      if (this.ctx.getWebSockets().length <= 1) {
        yield* engines.drop();
      }
    });
  }

  #onMessage(
    ws: WebSocket,
    raw: string,
  ): Effect.Effect<void, never, Connections | Engines> {
    return Effect.gen({ self: this }, function* () {
      const connections = yield* Connections;
      const engines = yield* Engines;

      const key = connections.keyOf(ws);
      // The attachment read is a platform call whose result is only used on
      // the keyless path (wasHelloed requires key === null), so skip it for
      // every authenticated frame rather than paying it per message.
      const marker = key === null ? connections.markerOf(ws) : null;

      // Lazy: dispatchFrame invokes getEngine only on its real-dispatch path,
      // so a heartbeat or handshake frame never triggers engine
      // construction. A failed construction rejects there and lands in this
      // error channel instead of propagating out of the handler as an
      // unhandled exception, which the Workers runtime logs — and
      // observability.logs.persist retains.
      const dispatched = yield* Effect.tryPromise({
        try: () =>
          dispatchFrame(raw, {
            workspace: {
              active: () =>
                this.#workspaces.has(ws) ||
                connections.markerOf(ws)?.workspace !== undefined,
              session: (threadId) => {
                const connection = connections.markerOf(ws);
                if (connection?.sessionId !== threadId)
                  throw new Error('Workspace session mismatch');
                let workspace = this.#workspaces.get(ws);
                if (!workspace) {
                  workspace = new AguiWorkspaceSession(
                    threadId,
                    connection.workspace,
                    (checkpoint) => {
                      ws.serializeAttachment({
                        ...connection,
                        workspace: checkpoint,
                      });
                    },
                  );
                  this.#workspaces.set(ws, workspace);
                }
                return workspace;
              },
              send: (event) => this.#send(ws, JSON.stringify(event), key),
            },
            helloReceived: key !== null,
            getEngine: () =>
              key ? Effect.runPromise(engines.forApiKey(key)) : null,
            wasHelloed: marker?.helloed === true && !connections.declined(ws),
            engineUnavailableReason: 'session engine unavailable',
          }),
        catch: (cause): Error =>
          cause instanceof EngineBuildError
            ? cause
            : new Error(
                cause instanceof Error ? cause.message : String(cause),
                {
                  cause,
                },
              ),
      }).pipe(Effect.result);

      if (Result.isFailure(dispatched)) {
        // Safe to log precisely because the factory redacted the message:
        // without a server-side line, a deployment where every visitor's
        // engine fails to build (a bad adapter upgrade, a provider outage)
        // is invisible to an operator — the only symptom is an error each
        // visitor sees alone.
        const failure = dispatched.failure;
        const label =
          failure instanceof EngineBuildError
            ? 'engine construction failed'
            : 'frame dispatch failed';
        console.error(`[session-do] ${label}: ${failure.message}`);
        this.#replyError(ws, raw, failure.message, key);
        return;
      }
      const result = dispatched.success;

      switch (result.kind) {
        case 'hello': {
          connections.markHello(
            ws,
            result.frame.apiKey,
            result.frame.sessionId,
          );
          // Replay whatever triggered the rehello, so the visitor's request
          // is answered rather than silently lost.
          const pending = connections.takePending(ws);
          if (pending !== undefined) {
            yield* this.#onMessage(ws, pending);
          }
          return;
        }
        case 'hello-declined': {
          // The client answered the rehello with "I have no key".
          // Definitive, so the buffered frame is never going to be replayable
          // — answer it now with the actionable error rather than holding it
          // until this socket closes, which would leave the visitor's
          // request to die on the client's correlator timeout with no
          // diagnostic at all.
          connections.markDecline(ws);
          const pending = connections.takePending(ws);
          if (pending !== undefined) this.#replyPreHello(ws, pending);
          return;
        }
        case 'rehello': {
          if (!connections.bufferPending(ws, raw)) {
            // A rehello for this socket is already outstanding and this
            // frame raced its answer. Only one frame can be buffered, so
            // this one gets an immediate reply instead — an accurate
            // "re-authenticating" error, not the key-drawer copy, which
            // would be a lie while the client's hello is in flight. The
            // ORIGINAL buffered frame stays put and is replayed when that
            // hello lands.
            this.#replyError(ws, raw, REAUTHENTICATING_ERROR, key);
            return;
          }
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
    });
  }

  /**
   * Answers a frame that arrived without a usable key, the same way a
   * never-helloed visitor is answered: an actionable engine.error, or a
   * close for traffic that isn't even a protocol envelope.
   */
  #replyPreHello(ws: WebSocket, raw: string): void {
    const input = readWorkspaceRun(raw);
    if (input) {
      rejectWorkspaceRun(
        input,
        (event) => this.#send(ws, JSON.stringify(event), null),
        'No API key set — open the key drawer to add one.',
      );
      return;
    }
    const outcome = resolvePreHelloDispatch(raw);
    if (outcome.kind === 'close') {
      ws.close(1002, 'expected playground.hello as the first frame');
      return;
    }
    this.#send(ws, encodeEnvelope(outcome.message), null);
  }

  /**
   * Scrubs the connection's key from every outbound frame. The key is passed
   * in rather than read back from custody here, because a dispatch that was
   * still awaiting the engine when this socket closed resumes AFTER the close
   * handler has already dropped the entry — re-reading would hand
   * `redactSecrets` no key and silently drop the exact-match pass on the one
   * frame most likely to be carrying a provider error.
   */
  #send(ws: WebSocket, wire: string, key: string | null): void {
    ws.send(redactSecrets(wire, key ?? undefined));
  }

  #replyError(ws: WebSocket, raw: string, message: string, key: string | null) {
    const input = readWorkspaceRun(raw);
    if (input)
      rejectWorkspaceRun(
        input,
        (event) => this.#send(ws, JSON.stringify(event), key),
        message,
      );
    else this.#send(ws, encodeEngineErrorReply(raw, message), key);
  }
}
