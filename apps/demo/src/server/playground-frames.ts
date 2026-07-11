import { isHeartbeatPingFrame } from '@maelstrom-co/client';
import { decodeClientEnvelope, EngineErrorMessage, isErr } from '@maelstrom-co/protocol';

export interface PlaygroundHelloFrame {
  readonly type: 'playground.hello';
  readonly sessionId: string;
  readonly apiKey: string;
}

export function isPlaygroundHello(value: unknown): value is PlaygroundHelloFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'playground.hello' &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string' &&
    typeof (value as { apiKey?: unknown }).apiKey === 'string'
  );
}

// Delegates to @maelstrom-co/client's isHeartbeatPingFrame — the same
// package that owns the client-side half of this handshake
// (WebSocketConnector's heartbeat sender) — so the wire literal is defined
// once, not reimplemented on each side of the connection.
export function isHeartbeatPing(value: unknown): value is { type: 'heartbeat.ping' } {
  return isHeartbeatPingFrame(value);
}

export type IncomingFrameDecision =
  | { readonly kind: 'heartbeat' }
  | { readonly kind: 'hello'; readonly frame: PlaygroundHelloFrame }
  | { readonly kind: 'hello-rejected' }
  | { readonly kind: 'dispatch' };

/**
 * Decides how the WS server should route a parsed incoming frame. The
 * heartbeat check runs before the hello gate: a keyless hosted visitor never
 * sends `playground.hello` (there's no key to hand the server), but the
 * client's heartbeat timer still fires 30s after connect regardless of
 * whether hello was sent. If the hello gate ran first, that heartbeat.ping
 * would be the "first frame" the gate ever sees, fail the
 * `isPlaygroundHello` check, and the socket would be closed out from under a
 * visitor who was only ever waiting to be prompted for a key.
 */
export function classifyIncomingFrame(
  parsed: unknown,
  helloReceived: boolean,
): IncomingFrameDecision {
  if (isHeartbeatPing(parsed)) return { kind: 'heartbeat' };
  if (helloReceived) return { kind: 'dispatch' };
  return isPlaygroundHello(parsed) ? { kind: 'hello', frame: parsed } : { kind: 'hello-rejected' };
}

export type PreHelloDispatchDecision =
  | { readonly kind: 'close' }
  | { readonly kind: 'reply'; readonly message: ReturnType<typeof EngineErrorMessage> };

/**
 * Decides what a 'hello-rejected' frame (real traffic, not heartbeat/hello,
 * arriving before playground.hello) earns. A keyless hosted visitor's
 * client still emits real protocol traffic pre-hello — a
 * ResizeObserver-driven chart_resize fires the moment the socket opens,
 * whether or not a key is set — so that traffic is not garbage and must not
 * close the socket; it gets a correlated engine.error reply instead. Only a
 * frame that doesn't even decode as a protocol envelope earns the close.
 */
export function resolvePreHelloDispatch(raw: unknown): PreHelloDispatchDecision {
  const decoded = decodeClientEnvelope(raw);
  if (isErr(decoded)) return { kind: 'close' };
  return {
    kind: 'reply',
    message: EngineErrorMessage({
      error: 'No API key set — open the key drawer to add one.',
      requestId: decoded.value.id,
      sessionId: decoded.value.sessionId,
    }),
  };
}
