import type { Orchestrator } from '@maelstrom-co/client';
import {
  GreetingCoordinator,
  type RealtimeSession,
  RealtimeSessionMemory,
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
  readonly #memories = new WeakMap<Orchestrator, RealtimeSessionMemory>();

  getOrCreate(
    orchestrator: Orchestrator,
    factory: (
      coordinator: GreetingCoordinator,
      memory: RealtimeSessionMemory,
    ) => RealtimeSession,
  ): SharedRealtimeSessionEntry {
    let entry = this.#entries.get(orchestrator);
    if (!entry) {
      const coordinator =
        this.#coordinators.get(orchestrator) ?? new GreetingCoordinator();
      this.#coordinators.set(orchestrator, coordinator);
      const sessionId = orchestrator.getConfig().sessionId;
      let memory = this.#memories.get(orchestrator);
      if (!memory || memory.sessionId !== sessionId) {
        memory = new RealtimeSessionMemory(sessionId);
        this.#memories.set(orchestrator, memory);
      }
      entry = {
        session: factory(coordinator, memory),
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
