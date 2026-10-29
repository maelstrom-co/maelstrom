export interface OrderedEmitter<Event> {
  emit(...events: Event[]): void;
  subscribe(listener: (event: Event) => void): () => void;
  isDelivering(): boolean;
  close(): void;
}

export interface OrderedEmitterOptions<Event> {
  readonly onDeliver?: (event: Event) => void;
}

export function createOrderedEmitter<Event>(
  options: OrderedEmitterOptions<Event> = {},
): OrderedEmitter<Event> {
  const listeners = new Set<(event: Event) => void>();
  const undelivered: Event[] = [];
  let delivering = false;
  let closed = false;
  const deliver = (event: Event) => {
    try {
      options.onDeliver?.(event);
    } catch {
      /* A failing delivery hook cannot interrupt the emitter's caller or listeners. */
    }
    for (const listener of [...listeners]) {
      if (closed) return;
      try {
        swallowRejection(listener(event));
      } catch {
        /* One listener cannot interrupt the emitter's caller or other listeners. */
      }
    }
  };
  return {
    emit(...events) {
      if (closed) return;
      undelivered.push(...events);
      // An event emitted from inside a listener waits until every listener has seen the current one.
      if (delivering) return;
      delivering = true;
      try {
        while (!closed && undelivered.length > 0) {
          const event = undelivered.shift();
          if (event === undefined) break;
          deliver(event);
        }
      } finally {
        delivering = false;
      }
    },
    subscribe(listener) {
      if (!closed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isDelivering: () => delivering,
    close() {
      closed = true;
      listeners.clear();
      undelivered.length = 0;
    },
  };
}

function swallowRejection(result: unknown): void {
  if (
    result &&
    (typeof result === 'object' || typeof result === 'function') &&
    'then' in result
  )
    void Promise.resolve(result).catch(() => {});
}
