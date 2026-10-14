import type { TelemetryMetadataObserver } from './types.js';

/** Shared synchronous metadata delivery with isolated observer failures. @internal */
export class MetadataObservers {
  private readonly listeners = new Set<TelemetryMetadataObserver>();

  /** Number of unique callbacks retaining local observation. */
  get size(): number {
    return this.listeners.size;
  }

  /** Subscribe once per callback identity. Release is idempotent. */
  subscribe(listener: TelemetryMetadataObserver): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Deliver to the initial listeners still subscribed at their turn, without awaiting callbacks. */
  emit(kind: string, metadata: Readonly<Record<string, unknown>>): void {
    for (const listener of [...this.listeners]) {
      if (!this.listeners.has(listener)) continue;
      try {
        const result: unknown = listener(kind, metadata);
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result
        )
          void Promise.resolve(result).catch(() => {});
      } catch {
        /* Optional observation cannot change producer work. */
      }
    }
  }

  /** Release all callbacks, including pending delivery in a reentrant emission. */
  clear(): void {
    this.listeners.clear();
  }
}
