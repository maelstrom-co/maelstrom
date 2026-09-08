/**
 * Transport-agnostic frame dispatch for the demo engine server.
 *
 * Returns a decision rather than performing I/O, so the two transports that
 * consume it — `Bun.serve` locally and `SessionDO` when hosted — share one
 * implementation of the handshake/heartbeat/dispatch ordering instead of two
 * that are free to drift.
 */
import {
  type Engine,
  handleEnvelope,
  recoverCorrelation,
} from '@maelstrom-co/engine';
import {
  decodeClientEnvelope,
  EngineErrorMessage,
  encodeEnvelope,
  isErr,
  type ServerEnvelope,
} from '@maelstrom-co/protocol';
import {
  classifyIncomingFrame,
  type PlaygroundHelloFrame,
  resolvePreHelloDispatch,
} from './playground-frames';

export interface DispatchContext {
  /** Whether this connection has completed a handshake in the current lifetime. */
  readonly helloReceived: boolean;
  /**
   * Resolves the engine to dispatch to, or null when none could be built.
   * Lazy — and called at most once, only on the real-dispatch path below —
   * so a transport whose resolution has side effects (SessionDO's engine
   * construction, which can fail) never pays for it on a heartbeat or hello
   * frame, which this function returns for before ever reaching that point.
   * May resolve asynchronously; a rejection propagates out of `dispatchFrame`
   * so the transport's own error channel can redact and report it.
   */
  readonly getEngine: () => Engine | null | Promise<Engine | null>;
  /**
   * Whether this connection completed a handshake at some point, even if the
   * key backing it is gone. Only ever true after a Durable Object wakes from
   * hibernation with its in-memory key reset. It is what distinguishes a
   * visitor who never had a key from a session whose key we dropped —
   * observationally identical without it.
   */
  readonly wasHelloed: boolean;
  /** Error text for the engine-null reply, chosen by the transport. */
  readonly engineUnavailableReason: string;
}

export type DispatchResult =
  | { readonly kind: 'heartbeat' }
  | { readonly kind: 'hello'; readonly frame: PlaygroundHelloFrame }
  | { readonly kind: 'rehello' }
  | { readonly kind: 'hello-declined' }
  | { readonly kind: 'close'; readonly code: number; readonly reason: string }
  | { readonly kind: 'reply'; readonly wire: string }
  | { readonly kind: 'none' };

/**
 * Builds a correlated `engine.error` reply for a frame that could not reach
 * an engine — whether none was ever built for this connection or
 * construction itself failed. Shared so every "no working engine" path
 * (including SessionDO's construction-failure catch) produces the same
 * correlation-recovery behavior instead of a second hand-rolled copy of it.
 */
export function encodeEngineErrorReply(raw: unknown, error: string): string {
  const decoded = decodeClientEnvelope(raw);
  return encodeEnvelope(
    isErr(decoded)
      ? EngineErrorMessage({ error, ...recoverCorrelation(raw) })
      : EngineErrorMessage({
          error,
          requestId: decoded.value.id,
          sessionId: decoded.value.sessionId,
        }),
  );
}

export async function dispatchFrame(
  raw: unknown,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    parsed = undefined;
  }

  const decision = classifyIncomingFrame(parsed, ctx.helloReceived);

  if (decision.kind === 'heartbeat') return { kind: 'heartbeat' };
  if (decision.kind === 'hello') {
    return { kind: 'hello', frame: decision.frame };
  }
  if (decision.kind === 'hello-declined') return { kind: 'hello-declined' };

  if (decision.kind === 'hello-rejected') {
    // Checked before the keyless-visitor path below, because both present
    // as "no key, no engine" and only this flag tells them apart.
    if (ctx.wasHelloed) return { kind: 'rehello' };

    const outcome = resolvePreHelloDispatch(raw);
    if (outcome.kind === 'close') {
      return {
        kind: 'close',
        code: 1002,
        reason: 'expected playground.hello as the first frame',
      };
    }
    return { kind: 'reply', wire: encodeEnvelope(outcome.message) };
  }

  const engine = await ctx.getEngine();
  if (!engine) {
    return {
      kind: 'reply',
      wire: encodeEngineErrorReply(raw, ctx.engineUnavailableReason),
    };
  }

  const reply = await handleEnvelope(engine, raw);
  logResizeDuplicationProbe(raw, reply);
  return reply
    ? { kind: 'reply', wire: encodeEnvelope(reply) }
    : { kind: 'none' };
}

/**
 * Re-decodes `raw` rather than threading `handleEnvelope`'s internal decode
 * out, since this is throwaway measurement code, not a permanent seam.
 */
function logResizeDuplicationProbe(
  raw: unknown,
  reply: ServerEnvelope | null,
): void {
  const decoded = decodeClientEnvelope(raw);
  if (isErr(decoded) || decoded.value.type !== 'chart_request') return;
  if (!reply || reply.type !== 'engine.maelstrom.response') return;

  const reasons = decoded.value.request.context.updateReasons;
  const planLength = reply.response.executionPlan.length;
  console.log(
    `[demo dispatch] reasons=${reasons.map((reason) => reason.type).join(',')} executionPlan=${planLength}`,
  );

  const resizeOnly =
    reasons.length > 0 &&
    reasons.every((reason) => reason.type === 'chart_resize');
  if (resizeOnly && planLength > 0) {
    console.warn(
      `[demo dispatch] HIT resize-only turn returned a non-empty executionPlan (n=${planLength})`,
    );
  }
}
