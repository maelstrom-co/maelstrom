import type { MessageId, SessionId } from '@maelstrom-co/protocol';
import { MessageId as brandMessageId } from '@maelstrom-co/protocol';

import type { RealtimeGreetingAdapter } from './realtime-session/provider-adapter.types.js';
import type { RealtimeInstance } from './realtime-session/realtime-session.types.js';

/**
 * Inputs for one greeting generation. Each successful
 * {@link import('./realtime-session/realtime-session.js').RealtimeSession.connect}
 * that reaches `connected` is one generation.
 */
export interface GreetingRunContext {
  readonly sessionId: SessionId;
  readonly text: string;
  readonly instance: RealtimeInstance;
  readonly adapter: RealtimeGreetingAdapter;
  readonly signal: AbortSignal;
  /** Emit one assistant caption through the session's transcript channel. */
  readonly emitTranscript: (text: string) => void;
}

/**
 * Provider-neutral greeting state machine.
 *
 * Owns persistence-before-caption/playback, same-session reconnect/recreation
 * idempotency (retained proofs), and new-session re-greet. Concrete speech is
 * delegated to {@link RealtimeGreetingAdapter.speakAssistantText}.
 *
 * **Engine-restart edge:** if the engine's history/dedup state is lost while a
 * session's `SessionId` persists, a later run would see `inserted` again and
 * re-greet within that session — currently out of demo scope.
 */
export class GreetingCoordinator {
  #sessionId: SessionId | undefined;
  #greetingId: MessageId | undefined;
  #persist: 'unstarted' | 'in_flight' | 'inserted' | 'suppressed' = 'unstarted';
  #caption: 'unpublished' | 'published' = 'unpublished';
  #speech: 'unstarted' | 'not_started' | 'accepted' = 'unstarted';
  #persistInFlight: Promise<void> | undefined;
  #speechInFlight: Promise<void> | undefined;

  /**
   * Drive one greeting generation for `context.sessionId`.
   *
   * Resolves only after the generation reaches a terminal state (`accepted`
   * speech, or `suppressed` persist) or a retriable pause (`not_started`
   * speech, failed/unstarted persist, abort, or engine not ready). Never
   * rejects: adapter throws and persistence failures are absorbed so callers
   * can fire-and-forget. Returns early without side effects when a newer
   * session has been adopted while this run awaited. It checks the current
   * session after every await and after the synchronous caption emit.
   */
  async run(context: GreetingRunContext): Promise<void> {
    const runSessionId = context.sessionId;
    this.#adoptSession(runSessionId);

    // Idempotency short-circuit: suppressed forever for this session, or a
    // fully completed greeting (persisted + spoken).
    if (this.#persist === 'suppressed') return;
    if (this.#persist === 'inserted' && this.#speech === 'accepted') return;

    const engineReady = await waitForEngineConnected(
      context.instance,
      context.signal,
    );
    // A different session may have adopted while we awaited; do not continue
    // against proofs that no longer belong to this run.
    if (!this.#isCurrentSession(runSessionId)) return;
    if (!engineReady || context.signal.aborted) return;

    await this.#persistGreeting(context);
    if (!this.#isCurrentSession(runSessionId)) return;
    if (context.signal.aborted) return;
    if (this.#persist !== 'inserted') return;

    if (this.#caption === 'unpublished') {
      // Mark published before emit so a re-entrant generation cannot double-fire.
      this.#caption = 'published';
      context.emitTranscript(context.text);
    }

    // The synchronous caption emit runs transcript handlers that can re-enter (a
    // session adoption mid-emit). Re-check the current session so the id passed
    // to the provider always pairs with this run's sessionId and text.
    if (!this.#isCurrentSession(runSessionId)) return;

    if (this.#speech === 'accepted') return;
    if (context.signal.aborted) return;

    await this.#speakGreeting(context, runSessionId);
  }

  /**
   * Derive the stable Engine message ID used for a session's greeting.
   * Reusing the ID lets Engine persistence deduplicate reconnect attempts.
   */
  greetingIdFor(sessionId: SessionId): MessageId {
    return brandMessageId(`greeting:${String(sessionId)}`);
  }

  #adoptSession(sessionId: SessionId): void {
    if (this.#sessionId === sessionId) return;
    this.#sessionId = sessionId;
    this.#greetingId = this.greetingIdFor(sessionId);
    this.#persist = 'unstarted';
    this.#caption = 'unpublished';
    this.#speech = 'unstarted';
    // Drop pointers so the new session never awaits a stale attempt. Prior
    // continuations still settle, but are generation-scoped and must not clear
    // a newer in-flight promise (see #persistGreeting / #speakGreeting).
    this.#persistInFlight = undefined;
    this.#speechInFlight = undefined;
  }

  #isCurrentSession(sessionId: SessionId): boolean {
    return this.#sessionId === sessionId;
  }

  async #speakGreeting(
    context: GreetingRunContext,
    runSessionId: SessionId,
  ): Promise<void> {
    if (this.#speechInFlight) {
      await this.#speechInFlight;
      return;
    }

    const greetingId = this.#greetingId;
    if (greetingId === undefined) return;

    // Tie the attempt to the session that started it. A later #adoptSession
    // resets proofs; the stale continuation must not write #speech / clear a
    // newer #speechInFlight (cross-session race).
    const attemptSessionId = runSessionId;

    this.#speechInFlight = (async () => {
      try {
        const result = await context.adapter.speakAssistantText({
          id: greetingId,
          text: context.text,
          signal: context.signal,
        });
        if (!this.#isCurrentSession(attemptSessionId)) return;
        if (result === 'accepted') {
          // Terminal even if the owning signal aborted while the adapter ran
          // (post-send abort is accepted at the adapter boundary).
          this.#speech = 'accepted';
          return;
        }
        // not_started is retriable only by a later generation — concurrent
        // same-generation waiters share this promise and must not re-invoke.
        this.#speech = 'not_started';
      } catch {
        // Adapter threw before returning a verdict: leave speech retriable.
        // Do not write #speech; a later generation may retry.
      }
    })().finally(() => {
      // Only the owning generation may clear the pointer; otherwise a stale
      // finally would drop a newer session's in-flight promise.
      if (this.#isCurrentSession(attemptSessionId)) {
        this.#speechInFlight = undefined;
      }
    });

    await this.#speechInFlight;
  }

  async #persistGreeting(context: GreetingRunContext): Promise<void> {
    if (this.#persist === 'suppressed') return;

    if (this.#persistInFlight) {
      await this.#persistInFlight;
      return;
    }

    const hadInserted = this.#persist === 'inserted';
    if (!hadInserted) {
      this.#persist = 'in_flight';
    }

    const greetingId = this.#greetingId;
    if (greetingId === undefined) {
      this.#persist = hadInserted ? 'inserted' : 'unstarted';
      return;
    }

    // Tie the attempt to the session that started it. A later #adoptSession
    // resets proofs for a new sessionId; the stale continuation must not write
    // #persist / clear a newer #persistInFlight (cross-session race).
    const attemptSessionId = this.#sessionId;
    if (attemptSessionId === undefined) {
      this.#persist = hadInserted ? 'inserted' : 'unstarted';
      return;
    }

    this.#persistInFlight = (async () => {
      try {
        const outcome = await context.instance.addAssistantMessageAcknowledged({
          id: greetingId,
          message: context.text,
        });
        if (!this.#isCurrentSession(attemptSessionId)) return;
        if (outcome === 'inserted') {
          this.#persist = 'inserted';
          return;
        }
        // deduped: keep retained inserted (late duplicate / not_started retry);
        // without evidence, suppress so we never re-play a possibly-spoken greeting.
        if (this.#persist === 'inserted' || hadInserted) {
          this.#persist = 'inserted';
          return;
        }
        this.#persist = 'suppressed';
      } catch {
        if (!this.#isCurrentSession(attemptSessionId)) return;
        // Engine error / timeout / disconnect — retry only on a later generation.
        if (this.#persist !== 'inserted' && !hadInserted) {
          this.#persist = 'unstarted';
        }
      }
    })().finally(() => {
      // Only the owning generation may clear the pointer; otherwise a stale
      // finally would drop a newer session's in-flight promise and allow a
      // double-persist.
      if (this.#isCurrentSession(attemptSessionId)) {
        this.#persistInFlight = undefined;
      }
    });

    await this.#persistInFlight;
  }
}

/**
 * Subscribe-then-snapshot wait for engine readiness. Resolves `true` on the
 * first `connected === true` (including a synchronous snapshot). Resolves
 * `false` when `signal` aborts first.
 */
function waitForEngineConnected(
  instance: RealtimeInstance,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      unsubscribe?.();
      resolve(value);
    };

    const onAbort = () => finish(false);
    signal.addEventListener('abort', onAbort, { once: true });

    unsubscribe = instance.observeEngineConnection((connected) => {
      if (connected) finish(true);
    });
    // observeEngineConnection may emit the current snapshot synchronously.
    // If that already settled finish, unsubscribe was still undefined inside
    // finish — clean up now that the assignment completed.
    if (settled) {
      unsubscribe();
    }
  });
}
