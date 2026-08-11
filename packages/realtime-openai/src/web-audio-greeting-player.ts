/**
 * Package-private Web Audio player for OpenAI greeting WAV playback.
 *
 * Activation is synchronous (click-gesture unlock): create one AudioContext,
 * call resume(), and start a one-sample silent buffer before returning.
 * Context is retained across reconnects; only the current source is stopped
 * on abort/stop — the context is never closed by this player.
 */

type AudioContextConstructor = new () => AudioContext;

export interface WebAudioGreetingPlayerOptions {
  /** Test-only factory override. Production uses `globalThis.AudioContext`. */
  readonly createAudioContext?: () => AudioContext;
}

export type GreetingPlayerReadiness =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_activated'
        | 'resume_failed'
        | 'unlock_failed'
        | 'activate_failed'
        | 'aborted'
        | 'context_closed';
    };

type ActivationOutcome = GreetingPlayerReadiness;

interface PlaybackHandle {
  readonly source: AudioBufferSourceNode | undefined;
  readonly settle: (error?: unknown) => void;
  readonly onAbort: () => void;
  readonly signal: AbortSignal;
}

/**
 * Settles when `promise` settles or `signal` aborts, whichever first.
 * Late resolution/rejection of `promise` is observed so it cannot surface as
 * an unhandled rejection after abort wins the race.
 */
export async function raceAbortSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<{ status: 'ok'; value: T } | { status: 'aborted' }> {
  if (signal.aborted) {
    void promise.then(
      () => {},
      () => {},
    );
    return { status: 'aborted' };
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      void promise.then(
        () => {},
        () => {},
      );
      resolve({ status: 'aborted' });
    };

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve({ status: 'ok', value });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function defaultCreateAudioContext(): AudioContext {
  const Ctor =
    (
      globalThis as typeof globalThis & {
        AudioContext?: AudioContextConstructor;
        webkitAudioContext?: AudioContextConstructor;
      }
    ).AudioContext ??
    (
      globalThis as typeof globalThis & {
        webkitAudioContext?: AudioContextConstructor;
      }
    ).webkitAudioContext;
  if (Ctor === undefined) {
    throw new Error('Web Audio API is not available');
  }
  return new Ctor();
}

export class WebAudioGreetingPlayer {
  readonly #createAudioContext: () => AudioContext;
  #context: AudioContext | undefined;
  /** Latest activation's generation-local combined outcome promise. */
  #activation: Promise<ActivationOutcome> | undefined;
  #playback: PlaybackHandle | undefined;

  constructor(options: WebAudioGreetingPlayerOptions = {}) {
    this.#createAudioContext =
      options.createAudioContext ?? defaultCreateAudioContext;
  }

  /**
   * Synchronously begin unlock work. Never throws. Safe to call repeatedly;
   * reuses the existing context and may call `resume()` again.
   *
   * Each call produces a generation-local outcome: silent-buffer unlock work
   * and `resume()` are combined so a later resume resolution cannot clear a
   * synchronous unlock failure from the same (or a newer) activation.
   */
  activate(): void {
    try {
      if (this.#context === undefined) {
        this.#context = this.#createAudioContext();
      }
      const context = this.#context;

      // Capture sync unlock outcome in this activation's closure only.
      let unlockError: unknown;
      try {
        const buffer = context.createBuffer(1, 1, context.sampleRate || 44100);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0);
      } catch (error) {
        unlockError = error;
      }

      // Generation-local promise: resume + unlock, no shared mutable error flag.
      this.#activation = Promise.resolve(context.resume()).then(
        (): ActivationOutcome => {
          if (unlockError !== undefined) {
            return { ok: false, reason: 'unlock_failed' };
          }
          return { ok: true };
        },
        (): ActivationOutcome => {
          if (unlockError !== undefined) {
            return { ok: false, reason: 'unlock_failed' };
          }
          return { ok: false, reason: 'resume_failed' };
        },
      );
    } catch {
      this.#activation = Promise.resolve({
        ok: false,
        reason: 'activate_failed',
      });
    }
  }

  /**
   * Pre-send readiness: fails for no activation, unlock/resume failure, or
   * abort. Races the activation promise against `signal` so a hanging
   * `resume()` cannot leave the caller pending after abort.
   */
  async ensureReady(signal: AbortSignal): Promise<GreetingPlayerReadiness> {
    if (signal.aborted) {
      return { ok: false, reason: 'aborted' };
    }
    if (this.#context === undefined || this.#activation === undefined) {
      return { ok: false, reason: 'not_activated' };
    }

    // Loop so a newer activate() while we await supersedes the older outcome.
    for (;;) {
      const activation: Promise<ActivationOutcome> | undefined =
        this.#activation;
      if (activation === undefined) {
        return { ok: false, reason: 'not_activated' };
      }

      let raced:
        | { status: 'ok'; value: ActivationOutcome }
        | { status: 'aborted' };
      try {
        raced = await raceAbortSignal(activation, signal);
      } catch {
        // Activation promise itself rejected (should not happen — outcomes are
        // values). Treat as failed readiness rather than throwing.
        return { ok: false, reason: 'activate_failed' };
      }

      if (raced.status === 'aborted') {
        return { ok: false, reason: 'aborted' };
      }

      // A newer activation replaced the promise we awaited — re-check latest.
      if (this.#activation !== activation) {
        if (signal.aborted) {
          return { ok: false, reason: 'aborted' };
        }
        continue;
      }

      if (!raced.value.ok) {
        return raced.value;
      }
      if (signal.aborted) {
        return { ok: false, reason: 'aborted' };
      }
      if (this.#context.state === 'closed') {
        return { ok: false, reason: 'context_closed' };
      }
      return { ok: true };
    }
  }

  /**
   * Decode a defensive copy of WAV bytes and play through a buffer source.
   * Resolves only from `onended` (or abort/stop). Abort listener is installed
   * before decode so cancellation during decode cannot hang.
   */
  async play(wavBytes: ArrayBuffer, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const context = this.#context;
    if (context === undefined) {
      throw new Error('WebAudioGreetingPlayer.play called before activate()');
    }

    // Defensive copy so a detached/transferable buffer cannot break decode.
    const copy = wavBytes.slice(0);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let source: AudioBufferSourceNode | undefined;

      const settle = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (this.#playback?.settle === settle) {
          this.#playback = undefined;
        }
        if (error !== undefined) reject(error);
        else resolve();
      };

      const onAbort = (): void => {
        if (source) this.#stopSource(source);
        settle();
      };

      // Register before any await so decode-phase abort/stop settles once.
      this.#playback = { source: undefined, settle, onAbort, signal };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }

      void (async () => {
        try {
          const audioBuffer = await context.decodeAudioData(copy);
          if (settled) return;

          source = context.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(context.destination);
          source.onended = () => settle();
          // Keep handle.source current for stop().
          if (this.#playback?.settle === settle) {
            this.#playback = { source, settle, onAbort, signal };
          }

          if (signal.aborted) {
            onAbort();
            return;
          }
          source.start(0);
        } catch (error) {
          if (source) this.#stopSource(source);
          settle(error);
        }
      })();
    });
  }

  /**
   * Stop current playback only. Idempotent. Does not close the AudioContext.
   */
  stop(): void {
    const current = this.#playback;
    if (current === undefined) return;
    this.#playback = undefined;
    current.signal.removeEventListener('abort', current.onAbort);
    if (current.source) this.#stopSource(current.source);
    current.settle();
  }

  #stopSource(source: AudioBufferSourceNode): void {
    try {
      source.stop();
    } catch {
      // stop() may throw (e.g. already-ended InvalidStateError); best-effort.
    }
    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}
