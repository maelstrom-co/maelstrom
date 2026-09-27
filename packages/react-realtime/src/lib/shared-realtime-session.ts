import type { Orchestrator } from '@maelstrom-co/client';
import {
  GreetingCoordinator,
  type RealtimeSession,
  RealtimeSessionMemory,
} from '@maelstrom-co/realtime';

/** Everything the registry hands over to build one session. */
export interface SharedRealtimeSessionBuildRequest<Provider> {
  readonly orchestrator: Orchestrator;
  readonly coordinator: GreetingCoordinator;
  readonly memory: RealtimeSessionMemory;
  readonly provider: Provider;
}

/** A built session and the app wiring to release when it is replaced or retired. */
export interface SharedRealtimeSessionBuild {
  readonly session: RealtimeSession;
  readonly release?: () => void;
}

export interface SharedRealtimeSessionEntry {
  readonly session: RealtimeSession;
}

/** Immutable registry state for one Orchestrator; a new object on every change. */
export interface SharedRealtimeSessionView<Provider> {
  readonly entry: SharedRealtimeSessionEntry;
  readonly provider: Provider;
  readonly switching: boolean;
}

export interface SharedRealtimeSessionRegistryOptions<Provider> {
  /** Read once per Orchestrator, when its first session is built. */
  readonly initialProvider: () => Provider;
  /** Builds a session; throwing leaves the registry unchanged. */
  readonly build: (
    request: SharedRealtimeSessionBuildRequest<Provider>,
  ) => SharedRealtimeSessionBuild;
}

interface Entry<Provider> extends SharedRealtimeSessionEntry {
  readonly provider: Provider;
  readonly release: (() => void) | undefined;
  consumers: number;
  phase: 'live' | 'retired';
  retirementQueued: boolean;
  released: boolean;
}

interface PendingSwitch<Provider> {
  readonly provider: Provider;
  readonly promise: Promise<void>;
}

interface Slot<Provider> {
  readonly coordinator: GreetingCoordinator;
  memory: RealtimeSessionMemory | undefined;
  provider: Provider;
  entry: Entry<Provider> | undefined;
  pendingSwitch: PendingSwitch<Provider> | undefined;
  view: SharedRealtimeSessionView<Provider> | undefined;
  readonly listeners: Set<() => void>;
}

/**
 * Package-private per-extension owner of Orchestrator session lifetime. It is
 * the only place that builds sessions, and an external store that hooks read
 * so they follow a provider switch.
 */
export class SharedRealtimeSessionRegistry<Provider> {
  readonly #slots = new WeakMap<Orchestrator, Slot<Provider>>();
  readonly #options: SharedRealtimeSessionRegistryOptions<Provider>;

  constructor(options: SharedRealtimeSessionRegistryOptions<Provider>) {
    this.#options = options;
  }

  /** Returns the current view, building a session when none is live. */
  read(orchestrator: Orchestrator): SharedRealtimeSessionView<Provider> {
    const slot = this.#slot(orchestrator);
    if (!slot.entry) {
      slot.entry = this.#build(orchestrator, slot, slot.provider);
      slot.view = undefined;
    }
    slot.view ??= {
      entry: slot.entry,
      provider: slot.provider,
      switching: slot.pendingSwitch !== undefined,
    };
    return slot.view;
  }

  /** Notifies after a switch starts, commits, or ends. */
  subscribe(orchestrator: Orchestrator, listener: () => void): () => void {
    const { listeners } = this.#slot(orchestrator);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /** Retains only from an effect; the returned release is idempotent. */
  retain(
    orchestrator: Orchestrator,
    entry: SharedRealtimeSessionEntry,
  ): () => void {
    const owned = entry as Entry<Provider>;
    owned.consumers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      owned.consumers = Math.max(0, owned.consumers - 1);
      this.#queueRetirement(orchestrator, owned);
    };
  }

  /** Connects the current session; refused while a switch runs. */
  connect(orchestrator: Orchestrator): Promise<void> {
    if (this.#slot(orchestrator).pendingSwitch) return Promise.resolve();
    return this.read(orchestrator).entry.session.connect();
  }

  /**
   * Replaces the current session with one for `provider`, keeping memory and
   * coordinator. A newer target supersedes this one, which then resolves
   * without building. With no live session, the choice is only remembered.
   */
  switchProvider(
    orchestrator: Orchestrator,
    provider: Provider,
  ): Promise<void> {
    const slot = this.#slot(orchestrator);
    if (slot.pendingSwitch?.provider === provider)
      return slot.pendingSwitch.promise;
    if (!slot.pendingSwitch && slot.provider === provider)
      return Promise.resolve();
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const pending: PendingSwitch<Provider> = {
      provider,
      promise: new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      }),
    };
    // Published before the old session starts disconnecting, so observers
    // reacting to its lifecycle events already see the pending switch.
    slot.pendingSwitch = pending;
    this.#notify(slot);
    const settle = (): void => {
      if (slot.pendingSwitch !== pending) return;
      slot.pendingSwitch = undefined;
      this.#notify(slot);
    };
    this.#runSwitch(orchestrator, slot, pending).then(
      () => {
        settle();
        resolve();
      },
      (error: unknown) => {
        settle();
        reject(error);
      },
    );
    return pending.promise;
  }

  async #runSwitch(
    orchestrator: Orchestrator,
    slot: Slot<Provider>,
    pending: PendingSwitch<Provider>,
  ): Promise<void> {
    let current = slot.entry;
    for (;;) {
      if (current) await current.session.disconnect();
      if (slot.pendingSwitch !== pending) return;
      if (slot.entry === current) break;
      current = slot.entry;
    }
    if (!current) {
      slot.provider = pending.provider;
      return;
    }
    if (current.provider === pending.provider) return;
    const next = this.#build(orchestrator, slot, pending.provider);
    current.phase = 'retired';
    slot.entry = next;
    slot.provider = pending.provider;
    releaseEntry(current);
  }

  #build(
    orchestrator: Orchestrator,
    slot: Slot<Provider>,
    provider: Provider,
  ): Entry<Provider> {
    const sessionId = orchestrator.getConfig().sessionId;
    if (!slot.memory || slot.memory.sessionId !== sessionId)
      slot.memory = new RealtimeSessionMemory(sessionId);
    const built = this.#options.build({
      orchestrator,
      coordinator: slot.coordinator,
      memory: slot.memory,
      provider,
    });
    return {
      session: built.session,
      release: built.release,
      provider,
      consumers: 0,
      phase: 'live',
      retirementQueued: false,
      released: false,
    };
  }

  #slot(orchestrator: Orchestrator): Slot<Provider> {
    let slot = this.#slots.get(orchestrator);
    if (!slot) {
      slot = {
        coordinator: new GreetingCoordinator(),
        memory: undefined,
        provider: this.#options.initialProvider(),
        entry: undefined,
        pendingSwitch: undefined,
        view: undefined,
        listeners: new Set(),
      };
      this.#slots.set(orchestrator, slot);
    }
    return slot;
  }

  #notify(slot: Slot<Provider>): void {
    slot.view = undefined;
    for (const listener of slot.listeners) listener();
  }

  #queueRetirement(orchestrator: Orchestrator, entry: Entry<Provider>): void {
    if (entry.retirementQueued) return;
    entry.retirementQueued = true;
    queueMicrotask(() => {
      entry.retirementQueued = false;
      if (entry.phase !== 'live' || entry.consumers > 0) return;
      entry.phase = 'retired';
      const slot = this.#slots.get(orchestrator);
      if (slot?.entry === entry) {
        slot.entry = undefined;
        slot.view = undefined;
      }
      void entry.session
        .disconnect()
        .catch(() => {})
        .finally(() => releaseEntry(entry));
    });
  }
}

function releaseEntry(entry: Entry<unknown>): void {
  if (entry.released) return;
  entry.released = true;
  try {
    entry.release?.();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}
