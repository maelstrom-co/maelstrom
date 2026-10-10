import { toError } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';
import type {
  EnqueueIntentOptions,
  IntentNotSubmittedReason,
  IntentQueueOptions,
  IntentResult,
  IntentSchedulerState,
  IntentScope,
  IntentSnapshot,
  IntentSubmission,
} from './intent-scheduler.types.js';

type Owner = { retired: boolean };
type Entry = {
  ticket: IntentSubmission;
  intent: string;
  owner?: Owner;
  expiresAt: number;
  disconnectedAt: number | null;
  done: boolean;
  resolve: (result: IntentResult) => void;
};

export class IntentScheduler {
  readonly store: Store<IntentSchedulerState>;
  readonly #policy: Required<IntentQueueOptions>;
  readonly #ready: () => boolean;
  readonly #run: (intent: string, live: () => boolean) => Promise<IntentResult>;
  readonly #automatic: () => void;
  readonly #onActiveDeadline: () => void;
  #owners = new WeakMap<IntentScope, Owner>();
  #pending: Entry[] = [];
  #active: Entry | null = null;
  #locked = false;
  #disposed = false;
  #connected = false;
  #counter = 0;
  #wakeQueued = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #activeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    options: IntentQueueOptions,
    hooks: {
      ready: () => boolean;
      run: (intent: string, live: () => boolean) => Promise<IntentResult>;
      automatic: () => void;
      onActiveDeadline?: () => void;
    },
  ) {
    this.#policy = {
      capacity: options.capacity ?? 8,
      maxWaitMs: options.maxWaitMs ?? 30_000,
      connectionGraceMs: options.connectionGraceMs ?? 10_000,
      activeTimeoutMs: options.activeTimeoutMs ?? 60_000,
    };
    for (const [key, value] of Object.entries(this.#policy)) {
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        (key === 'capacity'
          ? !Number.isSafeInteger(value)
          : value > 2_147_483_647)
      ) {
        throw new Error(
          `intentQueue.${key} must be positive and ${key === 'capacity' ? 'a safe integer' : 'at most 2147483647ms'}`,
        );
      }
    }
    this.#ready = hooks.ready;
    this.#run = hooks.run;
    this.#automatic = hooks.automatic;
    this.#onActiveDeadline = hooks.onActiveDeadline ?? (() => {});
    this.store = new Store<IntentSchedulerState>({
      phase: 'idle',
      pendingCount: 0,
      capacity: this.#policy.capacity,
      currentTicketId: null,
    });
  }

  createScope(): IntentScope {
    const owner = { retired: false };
    const scope: IntentScope = {
      enqueueIntent: (intent) => this.enqueue(intent, { scope }),
      retire: () => {
        if (owner.retired) return;
        owner.retired = true;
        const retired = this.#pending.filter((entry) => entry.owner === owner);
        this.#pending = this.#pending.filter((entry) => entry.owner !== owner);
        for (const entry of retired)
          this.#finish(entry, {
            status: 'not_submitted',
            reason: 'owner_retired',
          });
        this.#publish();
        this.wake();
      },
    };
    this.#owners.set(scope, owner);
    return scope;
  }

  enqueue(
    intent: string,
    options: EnqueueIntentOptions = {},
  ): IntentSubmission {
    const owner = options.scope ? this.#owners.get(options.scope) : undefined;
    if (options.scope && !owner)
      throw new Error('Intent scope belongs to another Orchestrator');
    this.#expire();
    const reason: IntentNotSubmittedReason | undefined = this.#disposed
      ? 'disposed'
      : owner?.retired
        ? 'owner_retired'
        : this.#pending.length >= this.#policy.capacity
          ? 'queue_full'
          : undefined;
    let resolve!: (result: IntentResult) => void;
    const result = new Promise<IntentResult>((settle) => {
      resolve = settle;
    });
    const ticket: IntentSubmission = Object.freeze({
      id: `intent-${++this.#counter}`,
      accepted: !reason,
      store: new Store<IntentSnapshot>({
        status: 'queued',
        queuePosition: this.#pending.length + 1,
      }),
      result,
    });
    const entry: Entry = {
      ticket,
      intent,
      owner,
      resolve,
      done: false,
      expiresAt: Date.now() + this.#policy.maxWaitMs,
      disconnectedAt: this.#connected ? null : Date.now(),
    };
    if (reason) this.#finish(entry, { status: 'not_submitted', reason });
    else this.#pending.push(entry);
    this.#publish();
    this.wake();
    return ticket;
  }

  acquire(): boolean {
    if (
      this.#disposed ||
      this.#locked ||
      this.#pending.length ||
      !this.#ready()
    )
      return false;
    this.#locked = true;
    this.#publish('sending');
    return true;
  }

  applying(): void {
    this.#publish('applying');
  }

  release(): void {
    this.#locked = false;
    this.#publish('idle');
    this.wake();
  }

  setConnected(connected: boolean): void {
    this.#expire();
    this.#connected = connected;
    for (const entry of this.#pending) {
      entry.disconnectedAt = connected
        ? null
        : (entry.disconnectedAt ?? Date.now());
    }
    this.#publish();
    this.wake();
  }

  retire(reason: 'disposed' | 'connector_replaced'): void {
    if (reason === 'disposed') this.#disposed = true;
    const pending = this.#pending;
    this.#pending = [];
    for (const entry of pending)
      this.#finish(entry, { status: 'not_submitted', reason });
    const active = this.#active;
    if (active) {
      this.#finish(active, {
        status: 'unknown',
        error: new Error(reason),
      });
      if (this.#active === active) this.#active = null;
    }
    clearTimeout(this.#activeTimer);
    this.#publish();
  }

  wake(): void {
    if (this.#wakeQueued || this.#disposed) return;
    this.#wakeQueued = true;
    void Promise.resolve().then(() => {
      this.#wakeQueued = false;
      this.#pump();
    });
  }

  #pump(): void {
    this.#expire();
    this.#publish();
    if (
      this.#disposed ||
      this.#locked ||
      !this.#ready() ||
      (!this.#connected && this.#pending.length > 0)
    )
      return;
    const entry = this.#pending.shift();
    if (!entry) {
      this.#automatic();
      return;
    }
    this.#locked = true;
    this.#active = entry;
    this.#activeTimer = setTimeout(() => {
      this.#finish(entry, {
        status: 'unknown',
        error: new Error('Intent active deadline exceeded'),
      });
      if (this.#active === entry) this.#active = null;
      this.#publish();
      this.#onActiveDeadline();
    }, this.#policy.activeTimeoutMs);
    // The lock and active entry precede notifications, which may reenter admission.
    this.#publish('sending');
    if (!entry.done)
      entry.ticket.store.setState(() => ({
        status: 'processing',
        queuePosition: null,
      }));
    void this.#run(entry.intent, () => !entry.done)
      .then(
        (result) => this.#finish(entry, result),
        (error) =>
          this.#finish(entry, { status: 'unknown', error: toError(error) }),
      )
      .finally(() => {
        clearTimeout(this.#activeTimer);
        this.#active = null;
        this.release();
      });
  }

  #finish(entry: Entry, result: IntentResult): void {
    if (entry.done) return;
    entry.done = true;
    entry.resolve(result);
    entry.ticket.store.setState(() => result);
  }

  #expire(): void {
    const now = Date.now();
    const expired = this.#pending.filter(
      (entry) => this.#deadline(entry) <= now,
    );
    this.#pending = this.#pending.filter(
      (entry) => this.#deadline(entry) > now,
    );
    for (const entry of expired)
      this.#finish(entry, {
        status: 'not_submitted',
        reason: entry.expiresAt <= now ? 'queue_expired' : 'disconnected',
      });
  }

  #deadline(entry: Entry): number {
    return Math.min(
      entry.expiresAt,
      entry.disconnectedAt === null
        ? Infinity
        : entry.disconnectedAt + this.#policy.connectionGraceMs,
    );
  }

  #publish(phase = this.store.state.phase): void {
    clearTimeout(this.#timer);
    if (this.#pending.length) {
      const deadline = Math.min(
        ...this.#pending.map((entry) => this.#deadline(entry)),
      );
      this.#timer = setTimeout(
        () => {
          this.#expire();
          this.#publish();
          this.wake();
        },
        Math.max(0, deadline - Date.now()),
      );
    }
    this.store.setState(() => ({
      phase,
      pendingCount: this.#pending.length,
      capacity: this.#policy.capacity,
      currentTicketId: this.#active?.ticket.id ?? null,
    }));
    for (const [index, entry] of [...this.#pending].entries()) {
      if (
        !entry.done &&
        entry.ticket.store.state.status === 'queued' &&
        entry.ticket.store.state.queuePosition !== index + 1
      ) {
        entry.ticket.store.setState(() => ({
          status: 'queued',
          queuePosition: index + 1,
        }));
      }
    }
  }
}
