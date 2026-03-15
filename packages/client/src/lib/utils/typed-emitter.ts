/**
 * Constraint for event map types.
 * Keys are event names, values are payload objects.
 */
export type EventMap = Record<string, object>;

/**
 * Read-only event subscription interface exposed to consumers.
 * Prevents consumers from calling emit() or dispose().
 */
export interface EventSubscriber<T extends EventMap> {
  on<K extends keyof T & string>(
    event: K,
    cb: (payload: T[K]) => void,
  ): () => void;
  off<K extends keyof T & string>(event: K, cb: (payload: T[K]) => void): void;
}

/**
 * Type-safe event emitter with disposal support.
 *
 * Uses a mapped type so each event key stores callbacks typed to its
 * own payload — zero `any`, zero casts.
 *
 * - Single emit() method: fire-and-forget, synchronous listener invocation.
 * - After dispose(): emit() silently no-ops, on() throws.
 * - Async listeners that reject have their errors caught and logged.
 *
 * Kernels own a TypedEmitter internally and expose it as
 * EventSubscriber via a public `events` getter.
 */
export class TypedEmitter<T extends EventMap> implements EventSubscriber<T> {
  /**
   * Per-key typed listener storage.
   * Callbacks return `unknown` internally so we can detect and catch
   * async rejections via `instanceof Promise` (no truthiness check on void).
   * Public API still accepts `(payload) => void` — void is assignable to unknown.
   */
  #listeners: {
    [K in keyof T & string]?: Set<(payload: T[K]) => unknown>;
  } = {};
  #disposed = false;

  on<K extends keyof T & string>(
    event: K,
    cb: (payload: T[K]) => void,
  ): () => void {
    if (this.#disposed) {
      throw new Error('Cannot subscribe to a disposed emitter');
    }

    let listeners = this.#listeners[event];
    if (!listeners) {
      listeners = new Set<(payload: T[K]) => unknown>();
      this.#listeners[event] = listeners;
    }

    listeners.add(cb);

    return () => this.off(event, cb);
  }

  off<K extends keyof T & string>(event: K, cb: (payload: T[K]) => void): void {
    this.#listeners[event]?.delete(cb);
  }

  emit<K extends keyof T & string>(event: K, payload: T[K]): void {
    if (this.#disposed) return;

    const listeners = this.#listeners[event];
    if (!listeners?.size) return;

    for (const listener of listeners) {
      try {
        const result = listener(payload);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`Error in async ${event} listener:`, err);
          });
        }
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  dispose(): void {
    this.#disposed = true;
    this.#listeners = {};
  }
}
