/**
 * Custody of the session's one engine.
 *
 * A Durable Object holds at most one engine, alongside the key it was built
 * from so a mismatch rebuilds rather than inherits. Rebuilding on a key
 * mismatch discards the previous engine's history — the intended trade: a
 * sessionId is correlation data, not a secret, so a second socket presenting
 * a DIFFERENT key may well be a different person. Handing them the running
 * engine would spend the first visitor's key on their behalf and show them
 * the first visitor's conversation. Two tabs sharing one key — the common
 * case — match on the cached key and share both engine and history as
 * intended. `drop` erases both when the last socket on the object closes;
 * keeping the plaintext key past that point would leak it past every
 * session's end.
 */

import type { Engine } from '@maelstrom-co/engine';
import { Context, Effect, Layer } from 'effect';
import { EngineBuildError, EngineFactory } from './engine-factory';

export interface EnginesService {
  /**
   * The engine for `apiKey`: returned from cache on a match, built through
   * {@link EngineFactory} otherwise (or after a `drop`, which is how a wake
   * from hibernation behaves). Construction is deferred to first use, so
   * handshake and heartbeat frames never pay for it.
   */
  readonly forApiKey: (
    apiKey: string,
  ) => Effect.Effect<Engine, EngineBuildError>;

  /** Discards the cached engine and its key. Idempotent. */
  readonly drop: () => Effect.Effect<void>;
}

export class Engines extends Context.Service<Engines, EnginesService>()(
  '@maelstrom/demo/SessionEngines',
) {}

export const EnginesLive: Layer.Layer<Engines, never, EngineFactory> =
  Layer.effect(
    Engines,
    Effect.gen(function* () {
      const factory = yield* EngineFactory;

      let engine: Engine | null = null;
      let engineKey: string | null = null;

      const forApiKey = (
        apiKey: string,
      ): Effect.Effect<Engine, EngineBuildError> =>
        Effect.suspend(() => {
          if (engine && engineKey === apiKey) return Effect.succeed(engine);
          return Effect.try({
            try: () => {
              // Synchronous on purpose. Construction is CPU-only work (the
              // provider adapter and redacting logger are plain objects), so
              // keeping read-match-build-write atomic per event preserves
              // the pre-rewrite guarantee that no other handler — in
              // particular the last-socket teardown's drop() — can interleave
              // between the build starting and the cache write landing. A
              // resurrected cache would retain the plaintext key past every
              // session's end; an async window here would also let two
              // concurrent first dispatches build duplicate engines and split
              // conversation history across them.
              const built = Effect.runSync(factory.make(apiKey));
              engine = built;
              engineKey = apiKey;
              return built;
            },
            catch: (cause): EngineBuildError =>
              cause instanceof EngineBuildError
                ? cause
                : // The factory's error channel only carries EngineBuildError,
                  // so this branch is a defect escaping local construction
                  // code (a programmer error), not a provider payload.
                  new EngineBuildError({ message: String(cause) }),
          });
        });

      const drop = (): Effect.Effect<void> =>
        Effect.sync(() => {
          engine = null;
          engineKey = null;
        });

      return Engines.of({ forApiKey, drop });
    }),
  );
