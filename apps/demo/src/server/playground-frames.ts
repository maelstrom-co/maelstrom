import { isHeartbeatPingFrame } from '@maelstrom-co/connectors';
import {
  decodeClientEnvelope,
  EngineErrorMessage,
  isErr,
} from '@maelstrom-co/protocol';

export interface PlaygroundHelloFrame {
  readonly type: 'playground.hello';
  readonly sessionId: string;
  readonly apiKey: string;
}

// A real OpenAI key is 40+ characters, so this floor can never reject a
// genuine key. Below it, redactSecrets's exact-match pass against a short
// string (e.g. a 1-3 char apiKey) rewrites unrelated substrings throughout
// every outbound frame — a key of "a" turns "executionPlan" into
// "executionPl[redacted]n" — so the client can't decode any reply and the
// request hangs to the correlator timeout instead of surfacing the "invalid
// API key" path a bad key should hit.
const MIN_API_KEY_LENGTH = 20;

// The hosted transport writes {helloed, sessionId} through
// `ws.serializeAttachment`, which the platform caps at 16,384 bytes and
// THROWS past — out of SessionDO's hello handler, which sits outside its
// dispatch try/catch, so an oversized id would surface as an unhandled
// exception that `observability.logs.persist` then retains. sessionId is
// attacker-controlled (any crafted frame carries whatever it likes), so the
// cap has to live here at the trust boundary rather than being assumed from
// the shipped client, which only ever sends a 21-char nanoid.
const MAX_SESSION_ID_LENGTH = 256;

export function isPlaygroundHello(
  value: unknown,
): value is PlaygroundHelloFrame {
  if (typeof value !== 'object' || value === null) return false;
  const { type, sessionId, apiKey } = value as {
    type?: unknown;
    sessionId?: unknown;
    apiKey?: unknown;
  };
  // Non-empty, not just string-typed: an empty sessionId would collapse
  // every crafted connection onto the same Durable Object (idFromName('')),
  // sharing one visitor's engine and history with anyone else who omits it.
  return (
    type === 'playground.hello' &&
    typeof sessionId === 'string' &&
    sessionId.length > 0 &&
    sessionId.length <= MAX_SESSION_ID_LENGTH &&
    typeof apiKey === 'string' &&
    apiKey.length >= MIN_API_KEY_LENGTH
  );
}

/**
 * The client's negative answer to `playground.rehello`: "I received your
 * request for a key and I do not have one."
 *
 * Without an explicit decline, a silent non-answer is observationally
 * identical to an answer still in flight, and the server has to guess.
 * Guessing wrong in either direction has a cost: treat a racing frame as a
 * decline and a visitor who has a perfectly good key is told they have none;
 * treat a decline as still-in-flight and their buffered request hangs until
 * the client's correlator gives up with no diagnostic at all.
 */
export function isPlaygroundNoKey(
  value: unknown,
): value is { type: 'playground.nokey' } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'playground.nokey'
  );
}

/** Wire frame for {@link isPlaygroundNoKey}, so both sides share one literal. */
export const PLAYGROUND_NOKEY_FRAME = JSON.stringify({
  type: 'playground.nokey',
});

// Delegates to @maelstrom-co/connectors' isHeartbeatPingFrame — the shared
// contract package that owns this handshake's wire shape for both sides
// (WebSocketConnector's heartbeat sender on the client, this guard on the
// host) — so the wire literal is defined once, not reimplemented on each side
// of the connection.
export function isHeartbeatPing(
  value: unknown,
): value is { type: 'heartbeat.ping' } {
  return isHeartbeatPingFrame(value);
}

export type IncomingFrameDecision =
  | { readonly kind: 'heartbeat' }
  | { readonly kind: 'hello'; readonly frame: PlaygroundHelloFrame }
  | { readonly kind: 'hello-declined' }
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
  // Only meaningful without a key in hand: a decline answers a rehello, and
  // a rehello is only ever sent to a connection whose key is gone. Placed
  // after the helloReceived gate so a stray or crafted decline on a healthy
  // connection is just undecodable traffic, never a way to disarm one.
  if (isPlaygroundNoKey(parsed)) return { kind: 'hello-declined' };
  return isPlaygroundHello(parsed)
    ? { kind: 'hello', frame: parsed }
    : { kind: 'hello-rejected' };
}

export type PreHelloDispatchDecision =
  | { readonly kind: 'close' }
  | {
      readonly kind: 'reply';
      readonly message: ReturnType<typeof EngineErrorMessage>;
    };

/**
 * Decides what a 'hello-rejected' frame (real traffic, not heartbeat/hello,
 * arriving before playground.hello) earns. A keyless hosted visitor's
 * client still emits real protocol traffic pre-hello — a
 * ResizeObserver-driven chart_resize fires the moment the socket opens,
 * whether or not a key is set — so that traffic is not garbage and must not
 * close the socket; it gets a correlated engine.error reply instead. Only a
 * frame that doesn't even decode as a protocol envelope earns the close.
 */
export function resolvePreHelloDispatch(
  raw: unknown,
): PreHelloDispatchDecision {
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
