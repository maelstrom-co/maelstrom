import type { AgentEvent, MessageId, RunId } from '@maelstrom-co/protocol';

/** The input or Agent Run whose silence window ran out. */
export type StaleSubject =
  | { readonly runId: RunId }
  | { readonly inputId: MessageId };

type InputWatch = {
  readonly kind: 'input';
  readonly inputId: MessageId;
  timer: ReturnType<typeof setTimeout> | undefined;
};

type RunWatch = {
  readonly kind: 'run';
  readonly runId: RunId;
  timer: ReturnType<typeof setTimeout> | undefined;
  sawOwnEvent: boolean;
  changesApplying: number;
};

/**
 * Silence timers for agent inputs and Agent Runs. Each watched subject holds
 * one timer that restarts on its activity, and the first timer to run out
 * reports its subject and clears every other timer.
 */
export class StaleRunWatch {
  readonly #windowMs: number;
  readonly #onStale: (subject: StaleSubject) => void;
  readonly #inputs = new Map<MessageId, InputWatch>();
  readonly #runs = new Map<RunId, RunWatch>();
  #changesApplying = 0;

  /**
   * Creates an empty watch. With an infinite window no subject is watched.
   */
  constructor(windowMs: number, onStale: (subject: StaleSubject) => void) {
    this.#windowMs = windowMs;
    this.#onStale = onStale;
  }

  /** Starts the window of an input as its frame is handed to the connector. */
  inputSent(inputId: MessageId): void {
    if (!Number.isFinite(this.#windowMs)) return;
    const watch: InputWatch = { kind: 'input', inputId, timer: undefined };
    this.#inputs.set(inputId, watch);
    if (this.#changesApplying === 0) this.#arm(watch);
  }

  /** Updates the windows for one agent event received from the connector. */
  observe(event: AgentEvent): void {
    this.#restartQueuedRuns();
    switch (event.type) {
      case 'placeholder': {
        const input = this.#inputs.get(event.inputId);
        if (input !== undefined && this.#changesApplying === 0) {
          this.#arm(input);
        }
        return;
      }
      case 'error':
        if (event.inputId !== undefined) this.stopInput(event.inputId);
        return;
      case 'accepted':
        this.#acceptInput(event.inputId, event.runId);
        return;
      case 'started':
      case 'message':
      case 'tool_call':
      case 'tool_result':
        this.#recordRunActivity(event.runId);
        return;
      case 'ui_change': {
        if (event.runId === null) return;
        const run = this.#runs.get(event.runId);
        if (run === undefined) return;
        run.sawOwnEvent = true;
        run.changesApplying += 1;
        this.#changesApplying += 1;
        this.#disarm(run);
        this.#pauseWaiting();
        return;
      }
      case 'finished':
        this.#stopRun(event.runId);
        return;
    }
  }

  /** Restarts the window of a run once its client-applied change was acknowledged. */
  changeAcknowledged(runId: RunId | null): void {
    if (runId === null) return;
    const run = this.#runs.get(runId);
    if (run === undefined || run.changesApplying === 0) return;
    run.changesApplying -= 1;
    this.#changesApplying -= 1;
    if (run.changesApplying === 0) this.#arm(run);
    if (this.#changesApplying === 0) this.#restartWaiting();
  }

  /** Stops watching one input, such as one whose frame was never sent. */
  stopInput(inputId: MessageId): void {
    const input = this.#inputs.get(inputId);
    if (input === undefined) return;
    this.#disarm(input);
    this.#inputs.delete(inputId);
  }

  /** Stops watching every subject. */
  clear(): void {
    for (const watch of this.#inputs.values()) this.#disarm(watch);
    for (const watch of this.#runs.values()) this.#disarm(watch);
    this.#inputs.clear();
    this.#runs.clear();
    this.#changesApplying = 0;
  }

  #acceptInput(inputId: MessageId, runId: RunId | null): void {
    if (!this.#inputs.has(inputId)) return;
    this.stopInput(inputId);
    if (runId === null) return;
    const existing = this.#runs.get(runId);
    if (existing !== undefined) {
      if (existing.changesApplying === 0 && existing.sawOwnEvent) {
        this.#arm(existing);
      }
      return;
    }
    const run: RunWatch = {
      kind: 'run',
      runId,
      timer: undefined,
      sawOwnEvent: false,
      changesApplying: 0,
    };
    this.#runs.set(runId, run);
    if (this.#changesApplying === 0) this.#arm(run);
  }

  #recordRunActivity(runId: RunId): void {
    const run = this.#runs.get(runId);
    if (run === undefined) return;
    run.sawOwnEvent = true;
    if (run.changesApplying === 0) this.#arm(run);
  }

  // A run the agent has not started yet may be queued behind another, so any
  // traffic on the stream shows the agent is still alive on its behalf.
  #restartQueuedRuns(): void {
    if (this.#changesApplying > 0) return;
    for (const run of this.#runs.values()) {
      if (!run.sawOwnEvent) this.#arm(run);
    }
  }

  // The agent sends nothing while it waits for a change to be applied, so
  // inputs and queued runs waiting behind that change must not time out.
  #pauseWaiting(): void {
    for (const input of this.#inputs.values()) this.#disarm(input);
    for (const run of this.#runs.values()) {
      if (!run.sawOwnEvent) this.#disarm(run);
    }
  }

  #restartWaiting(): void {
    for (const input of this.#inputs.values()) this.#arm(input);
    this.#restartQueuedRuns();
  }

  #stopRun(runId: RunId): void {
    const run = this.#runs.get(runId);
    if (run === undefined) return;
    this.#disarm(run);
    this.#runs.delete(runId);
    if (run.changesApplying === 0) return;
    this.#changesApplying -= run.changesApplying;
    if (this.#changesApplying === 0) this.#restartWaiting();
  }

  #arm(watch: InputWatch | RunWatch): void {
    this.#disarm(watch);
    watch.timer = setTimeout(() => {
      watch.timer = undefined;
      this.clear();
      this.#onStale(
        watch.kind === 'run'
          ? { runId: watch.runId }
          : { inputId: watch.inputId },
      );
    }, this.#windowMs);
  }

  #disarm(watch: InputWatch | RunWatch): void {
    if (watch.timer === undefined) return;
    clearTimeout(watch.timer);
    watch.timer = undefined;
  }
}
