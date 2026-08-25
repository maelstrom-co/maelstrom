import type { MessageId, SessionId } from '@maelstrom-co/protocol';
import { MessageId as brandMessageId } from '@maelstrom-co/protocol';

import type { RealtimeGreetingAdapter } from './realtime-session/provider-adapter.types.js';
import type { RealtimeInstance } from './realtime-session/realtime-session.types.js';

type GreetingPersistState =
  | 'unstarted'
  | 'in_flight'
  | 'inserted'
  | 'suppressed';

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

/** Whether replay remains possible for a session's configured greeting. */
export type GreetingCoordinatorLifecycle = 'pending' | 'terminal';

/** Why a greeting session became terminal. */
export type GreetingTerminalReason = 'presented' | 'suppressed' | 'skipped';

/**
 * Minimal replay-eligibility proof retained by {@link GreetingCoordinator}.
 * `terminal` means replay is forbidden; `pending` permits a later generation.
 * The snapshot deliberately contains no provider phase, failure, or run
 * disposition.
 */
export type GreetingCoordinatorSnapshot =
  | { readonly lifecycle: 'pending' }
  | {
      readonly lifecycle: 'terminal';
      readonly reason: GreetingTerminalReason;
    };

/**
 * Result of one coordinator run. Terminal results forbid replay, retryable
 * results permit a later connection generation, and `stale` has no effect on
 * the currently adopted session.
 */
export type GreetingRunDisposition =
  | 'accepted'
  | 'already_terminal'
  | 'suppressed'
  | 'skipped'
  | 'not_started'
  | 'failed'
  | 'aborted'
  | 'stale';

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
  #persist: GreetingPersistState = 'unstarted';
  #caption: 'unpublished' | 'published' = 'unpublished';
  #speech: 'unstarted' | 'not_started' | 'accepted' = 'unstarted';
  // Explicit user choice is independent of persistence and speech progress so
  // an in-flight continuation can never erase it.
  #skipped = false;
  #persistInFlight: Promise<void> | undefined;
  #speechInFlight: Promise<GreetingRunDisposition> | undefined;

  /**
   * Reads replay eligibility for `sessionId` without adopting the session,
   * mutating coordinator state, or starting greeting work. Unknown sessions
   * and non-terminal attempts report `pending`; terminal proof remains
   * observable across provider-session recreation. The result does not expose
   * provider phase, failure details, or an internal run disposition.
   */
  getSnapshot(sessionId: SessionId): GreetingCoordinatorSnapshot {
    if (this.#sessionId !== sessionId) return { lifecycle: 'pending' };
    const reason = this.#terminalReason();
    return reason === undefined
      ? { lifecycle: 'pending' }
      : { lifecycle: 'terminal', reason };
  }

  /**
   * Synchronously make the configured greeting terminal for this session.
   * Returns true only for the winning transition; presented and suppressed
   * proof are intentionally never rewritten by a late Skip.
   */
  skip(sessionId: SessionId): boolean {
    this.#adoptSession(sessionId);
    if (this.#terminalReason() !== undefined) return false;
    this.#skipped = true;
    return true;
  }

  /**
   * Drive one greeting generation for `context.sessionId`.
   *
   * Resolves only after the generation reaches a terminal state (`accepted`
   * speech, or `suppressed` persist) or a retriable pause (`not_started`
   * speech, failed/unstarted persist, abort, or engine not ready). Never
   * rejects: adapter throws and persistence failures become `failed` so callers
   * can fire-and-forget. `accepted`, `already_terminal`, and `suppressed`
   * retain terminal proof; `not_started`, `failed`, and `aborted` remain
   * retryable by a later generation. `stale` performs no work after a newer
   * session is adopted. Ownership is checked after every await and after the
   * synchronous caption emit.
   *
   * @internal
   */
  async run(context: GreetingRunContext): Promise<GreetingRunDisposition> {
    const runSessionId = context.sessionId;
    this.#adoptSession(runSessionId);

    // Idempotency short-circuit: suppressed forever for this session, or a
    // fully completed greeting (persisted + spoken).
    if (this.#skipped) return 'skipped';
    if (this.#persist === 'suppressed') return 'suppressed';
    if (this.#persist === 'inserted' && this.#speech === 'accepted') {
      return 'already_terminal';
    }

    try {
      const engineReady = await waitForEngineConnected(
        context.instance,
        context.signal,
      );
      if (!this.#isCurrentSession(runSessionId)) return 'stale';
      if (this.#skipped) return 'skipped';
      if (!engineReady || context.signal.aborted) return 'aborted';

      await this.#persistGreeting(context);
      if (!this.#isCurrentSession(runSessionId)) return 'stale';
      if (this.#skipped) return 'skipped';
      const persistAfterAttempt = this.#persist as GreetingPersistState;
      if (persistAfterAttempt === 'suppressed') return 'suppressed';
      if (context.signal.aborted) return 'aborted';
      if (persistAfterAttempt !== 'inserted') return 'failed';

      if (this.#speech === 'accepted') return 'already_terminal';
      if (context.signal.aborted) return 'aborted';

      const disposition = await this.#speakGreeting(context, runSessionId);
      return this.#isSkippedCurrent(runSessionId) ? 'skipped' : disposition;
    } catch {
      if (!this.#isCurrentSession(runSessionId)) return 'stale';
      if (this.#skipped) return 'skipped';
      if (this.#speech === 'accepted') return 'accepted';
      if (context.signal.aborted) return 'aborted';
      return 'failed';
    }
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
    this.#skipped = false;
    // Drop pointers so the new session never awaits a stale attempt. Prior
    // continuations still settle, but are generation-scoped and must not clear
    // a newer in-flight promise (see #persistGreeting / #speakGreeting).
    this.#persistInFlight = undefined;
    this.#speechInFlight = undefined;
  }

  #isCurrentSession(sessionId: SessionId): boolean {
    return this.#sessionId === sessionId;
  }

  #isSkippedCurrent(sessionId: SessionId): boolean {
    return this.#isCurrentSession(sessionId) && this.#skipped;
  }

  #terminalReason(): GreetingTerminalReason | undefined {
    if (this.#skipped) return 'skipped';
    if (this.#persist === 'suppressed') return 'suppressed';
    if (this.#persist === 'inserted' && this.#speech === 'accepted') {
      return 'presented';
    }
    return undefined;
  }

  async #speakGreeting(
    context: GreetingRunContext,
    runSessionId: SessionId,
  ): Promise<GreetingRunDisposition> {
    if (this.#isSkippedCurrent(runSessionId)) return 'skipped';
    if (this.#speechInFlight) {
      return this.#speechInFlight;
    }

    const greetingId = this.#greetingId;
    if (greetingId === undefined) return 'stale';

    // Tie the attempt to the session that started it. A later #adoptSession
    // resets proofs; the stale continuation must not write #speech / clear a
    // newer #speechInFlight (cross-session race).
    const attemptSessionId = runSessionId;

    const attempt = Promise.resolve().then(async () => {
      try {
        const result = await context.adapter.speakAssistantText({
          id: greetingId,
          text: context.text,
          signal: context.signal,
          onPlaybackStart: () => {
            if (!this.#isCurrentSession(attemptSessionId) || this.#skipped)
              return;
            if (this.#caption === 'published') return;
            // Mark before emit so re-entrant playback signals cannot double-fire.
            this.#caption = 'published';
            context.emitTranscript(context.text);
          },
        });
        if (!this.#isCurrentSession(attemptSessionId)) return 'stale';
        if (this.#skipped) return 'skipped';
        if (result === 'accepted') {
          // Terminal even if the owning signal aborted while the adapter ran
          // (post-send abort is accepted at the adapter boundary).
          this.#speech = 'accepted';
          return 'accepted';
        }
        if (context.signal.aborted) return 'aborted';
        // not_started is retriable only by a later generation — concurrent
        // same-generation waiters share this promise and must not re-invoke.
        this.#speech = 'not_started';
        return 'not_started';
      } catch {
        if (!this.#isCurrentSession(attemptSessionId)) return 'stale';
        if (this.#skipped) return 'skipped';
        if (context.signal.aborted) return 'aborted';
        // Adapter threw before returning a verdict: leave speech retriable.
        // Do not write #speech; a later generation may retry.
        return 'failed';
      }
    });
    const trackedAttempt = attempt.finally(() => {
      // Only the owning generation may clear the pointer; otherwise a stale
      // finally would drop a newer session's in-flight promise.
      if (this.#isCurrentSession(attemptSessionId)) {
        this.#speechInFlight = undefined;
      }
    });
    this.#speechInFlight = trackedAttempt;

    return trackedAttempt;
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
