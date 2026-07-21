import { RealtimeVoiceError } from './realtime-voice-error.js';

/**
 * A single `connect()` attempt handed out by {@link ConnectRaceGuard.begin}.
 *
 * A provider adapter's `connect()` interleaves awaits (token mint, transport
 * join, mic acquisition) with shared-field writes. Between those awaits a
 * `disconnect()` or a newer `connect()` can overtake this one; re-checking the
 * attempt after each await tells the stale winner-loser apart so a superseded
 * attempt abandons its own resources instead of clobbering the winner's.
 */
export interface ConnectAttempt {
  /**
   * `true` while no newer `begin()` or `supersede()` has overtaken this attempt.
   * Non-throwing, for cleanup branches (e.g. a `catch` deciding whether to reset
   * shared state) — a superseded attempt must NOT run teardown, which belongs to
   * the winner.
   */
  readonly isCurrent: boolean;
  /**
   * Throw {@link RealtimeVoiceError} `CONNECT_SUPERSEDED` if a newer attempt or a
   * teardown overtook this one. Call after each `connect()` await, before
   * publishing to shared fields, so a stale attempt aborts rather than joining a
   * transport nobody owns.
   */
  assertCurrent(): void;
}

/**
 * A monotonic generation counter that lets a provider adapter's `connect()`
 * detect, once each of its awaits resumes, that a newer `connect()` or a
 * `disconnect()`/teardown overtook it — so the stale attempt aborts instead of
 * clobbering the winner's shared connection state.
 *
 * One instance per adapter, held for the adapter's lifetime. `begin()` opens a
 * fresh attempt (superseding any in-flight one); `supersede()` invalidates the
 * current attempt from teardown so a mid-handshake `connect()` abandons itself.
 * Both adapters (`@maelstrom-co/realtime`'s OpenAI adapter and the separate
 * `@maelstrom-co/realtime-livekit`) share this so superseded-connect behavior is
 * uniform — a superseded attempt always rejects with `CONNECT_SUPERSEDED`,
 * never resolves as if it succeeded.
 *
 * @example
 * ```ts
 * async connect(): Promise<void> {
 *   const attempt = this.#guard.begin();
 *   const token = await this.#mintToken();
 *   attempt.assertCurrent();       // throws CONNECT_SUPERSEDED if overtaken
 *   this.#connection = await join(token);
 *   attempt.assertCurrent();
 *   // ...publish to shared fields, now known safe
 * }
 *
 * #teardown(): void {
 *   this.#guard.supersede();       // any in-flight connect() abandons itself
 *   // ...null shared fields
 * }
 * ```
 */
export class ConnectRaceGuard {
  #generation = 0;

  /**
   * Open a new connect attempt, superseding any in-flight one. Returns a handle
   * the caller re-checks after each await to detect being overtaken.
   */
  begin(): ConnectAttempt {
    const generation = ++this.#generation;
    const current = (): boolean => generation === this.#generation;
    return {
      get isCurrent(): boolean {
        return current();
      },
      assertCurrent: (): void => {
        if (!current()) {
          throw new RealtimeVoiceError(
            'CONNECT_SUPERSEDED',
            'connect() was superseded by a newer connect() or teardown',
          );
        }
      },
    };
  }

  /**
   * Invalidate the current attempt (call from teardown/disconnect) so a
   * `connect()` still mid-handshake abandons its own attempt when its awaits
   * resume instead of publishing to shared state the teardown just cleared.
   */
  supersede(): void {
    this.#generation += 1;
  }
}
