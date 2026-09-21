import type { Loader } from 'astro/loaders';

/**
 * Repairs empty glob reconciliation and buffers watcher events until glob installs handlers.
 * Empty scans clear stale entries; nonempty scans and post-handoff events retain glob behavior.
 * Failed watched loads are logged and retried on queued or subsequent filesystem events.
 */
export function blogLoader(
  delegate: Loader,
  directory: (context: Parameters<Loader['load']>[0]) => string,
  hasEntries: (directory: string) => Promise<boolean>,
): Loader {
  return {
    name: 'blog-glob',
    async load(context) {
      const base = directory(context);
      const { watcher } = context;
      if (!watcher) {
        if (await hasEntries(base)) await delegate.load(context);
        else context.store.clear();
        return;
      }
      const events = ['add', 'change', 'unlink'] as const;
      type Event = (typeof events)[number];
      type Handler = (path: string) => unknown;
      const handlers = new Map<Event, Handler>();
      const pending: [Event, string][] = [];
      let loading = false;
      let ready = false;
      const bufferedWatcher = new Proxy(watcher, {
        get(target, property) {
          if (property === 'on')
            return (event: Event, handler: Handler) => {
              handlers.set(event, handler);
              return bufferedWatcher;
            };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      async function drain() {
        if (loading || ready) return;
        loading = true;
        try {
          do {
            if (!events.every((event) => handlers.has(event))) {
              pending.length = 0;
              if (await hasEntries(base)) {
                try {
                  await delegate.load({ ...context, watcher: bufferedWatcher });
                } catch (error) {
                  context.logger.error(String(error));
                }
              } else context.store.clear();
            }
            if (events.every((event) => handlers.has(event))) {
              while (pending.length) {
                const event = pending.shift();
                if (event) await handlers.get(event[0])?.(event[1]);
              }
              // No await between draining and handoff: no event can fall between them.
              for (const event of events) {
                watcher?.off(event, listeners[event]);
                const handler = handlers.get(event);
                if (handler) watcher?.on(event, handler);
              }
              ready = true;
            }
          } while (!ready && pending.length);
        } finally {
          loading = false;
        }
      }
      const enqueue = (event: Event) => (path: string) => {
        pending.push([event, path]);
        return drain();
      };
      const listeners = {
        add: enqueue('add'),
        change: enqueue('change'),
        unlink: enqueue('unlink'),
      };
      for (const event of events) watcher.on(event, listeners[event]);
      watcher.add(base);
      await drain();
    },
  };
}
