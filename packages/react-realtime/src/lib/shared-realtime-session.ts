import type { Orchestrator } from '@maelstrom-co/client';
import {
  GreetingCoordinator,
  type RealtimeSession,
} from '@maelstrom-co/realtime';

export interface SharedRealtimeSessionEntry {
  readonly session: RealtimeSession;
}

interface Entry extends SharedRealtimeSessionEntry {
  consumers: number;
  phase: 'live' | 'retired';
  retirementQueued: boolean;
}

/** Package-private per-extension owner for Orchestrator session lifetime. */
export class SharedRealtimeSessionRegistry {
  readonly #entries = new WeakMap<Orchestrator, Entry>();
  readonly #coordinators = new WeakMap<Orchestrator, GreetingCoordinator>();

  getOrCreate(
    orchestrator: Orchestrator,
    factory: (coordinator: GreetingCoordinator) => RealtimeSession,
  ): SharedRealtimeSessionEntry {
    let entry = this.#entries.get(orchestrator);
    if (!entry) {
      const coordinator =
        this.#coordinators.get(orchestrator) ?? new GreetingCoordinator();
      this.#coordinators.set(orchestrator, coordinator);
      entry = {
        session: factory(coordinator),
        consumers: 0,
        phase: 'live',
        retirementQueued: false,
      };
      this.#entries.set(orchestrator, entry);
    }
    return entry;
  }

  /** Retains only from an effect; the returned release is idempotent. */
  retain(
    orchestrator: Orchestrator,
    entry: SharedRealtimeSessionEntry,
  ): () => void {
    const owned = entry as Entry;
    owned.consumers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      owned.consumers = Math.max(0, owned.consumers - 1);
      this.#queueRetirement(orchestrator, owned);
    };
  }

  #queueRetirement(orchestrator: Orchestrator, entry: Entry): void {
    if (entry.retirementQueued) return;
    entry.retirementQueued = true;
    queueMicrotask(() => {
      entry.retirementQueued = false;
      if (entry.phase !== 'live' || entry.consumers > 0) return;
      entry.phase = 'retired';
      if (this.#entries.get(orchestrator) === entry)
        this.#entries.delete(orchestrator);
      void entry.session.disconnect().catch(() => {});
    });
  }
}
