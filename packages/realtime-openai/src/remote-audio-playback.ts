import type { Unsubscribe } from '@maelstrom-co/client';

/**
 * Last remote HTML audio playback attempt for the current attached stream.
 * `unavailable` has no stream; `ready` has an unconfirmed stream; `blocked`
 * records an autoplay-policy refusal. `playing` records browser acceptance of
 * `play()`, not audible output, received frames, or continuous playback.
 */
export type OpenAIAudioPlaybackStatus =
  | 'unavailable'
  | 'ready'
  | 'playing'
  | 'blocked';

/** @internal Owns playback-attempt evidence for adapter-owned audio elements. */
export class RemoteAudioPlayback {
  #binding:
    | {
        readonly audio: HTMLAudioElement;
        readonly stream: MediaStream | undefined;
      }
    | undefined;
  #attempt = 0;
  #revision = 0;
  #status: OpenAIAudioPlaybackStatus = 'unavailable';
  readonly #listeners = new Set<() => void>();

  getStatus(): OpenAIAudioPlaybackStatus {
    return this.#status;
  }

  subscribe(handler: () => void): Unsubscribe {
    this.#listeners.add(handler);
    return () => {
      this.#listeners.delete(handler);
    };
  }

  attach(audio: HTMLAudioElement, stream: MediaStream | undefined): void {
    const binding = { audio, stream };
    this.#binding = binding;
    const attempt = ++this.#attempt;
    this.#setStatus(stream ? 'ready' : 'unavailable');
    // An observer can retire the binding or start its own retry synchronously.
    if (stream && this.#binding === binding && this.#attempt === attempt)
      void this.resume().catch(() => {});
  }

  clear(): void {
    this.#binding = undefined;
    this.#attempt += 1;
    this.#setStatus('unavailable');
  }

  async resume(): Promise<void> {
    const binding = this.#binding;
    if (!binding?.stream) return;
    const attempt = ++this.#attempt;
    const current = () =>
      this.#binding === binding && this.#attempt === attempt;
    try {
      await binding.audio.play();
      if (current()) this.#setStatus('playing');
    } catch (error) {
      if (!current()) return;
      const blocked = blockedByPolicy(error);
      if (!current()) return;
      this.#setStatus(blocked ? 'blocked' : 'ready');
      if (current())
        throw new Error('Audio playback could not start', { cause: error });
    }
  }

  #setStatus(status: OpenAIAudioPlaybackStatus): void {
    if (status === this.#status) return;
    this.#status = status;
    const revision = ++this.#revision;
    for (const listener of [...this.#listeners]) {
      if (revision !== this.#revision) return;
      if (!this.#listeners.has(listener)) continue;
      try {
        void Promise.resolve(listener()).catch(() => {});
      } catch {
        /* Observers cannot interrupt playback or teardown. */
      }
    }
  }
}

function blockedByPolicy(error: unknown): boolean {
  try {
    return (
      typeof error === 'object' &&
      error !== null &&
      Reflect.get(error, 'name') === 'NotAllowedError'
    );
  } catch {
    return false;
  }
}
