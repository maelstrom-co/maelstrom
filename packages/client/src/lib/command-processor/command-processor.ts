import type {
  ActionExecution,
  ActionName,
  GridLayout,
  InstanceId,
  Result,
  TilingLayout,
  VariantName,
  VesselDefinition,
} from '@maelstrom-co/protocol';
import {
  describeDuplicateTilingLeaf,
  err,
  findDuplicateTilingLeaves,
  ok,
  toError,
} from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

import type { Unsubscribe } from '../types.js';
import { Logger } from '../utils/logger.js';
import { type EventSubscriber, TypedEmitter } from '../utils/typed-emitter.js';
import { ActionManager } from './action-manager.js';
import type {
  ActionRunner,
  BatchExecutionResult,
} from './action-runner.types.js';
import type { Command, ExecuteActionsCommand } from './command.types.js';
import {
  type CommandProcessingState,
  createInitialCommandProcessingState,
} from './command-processor.state.js';
import type { CommandProcessorOptions } from './command-processor.types.js';
import { applyLayout } from './layout-manager.js';

/**
 * Event map for CommandProcessor lifecycle events.
 */
export type CommandProcessorEvents = {
  command_start: { command: Command; timestamp: number };
  command_complete: {
    command: Command;
    duration: number;
    timestamp: number;
  };
  processing_error: {
    command: Command;
    error: Error;
    timestamp: number;
  };
  /**
   * Fired when a command in a multi-command batch throws and the rest of
   * that batch is abandoned. `failed` is the command that threw (already
   * reported through `processing_error`); `abandoned` are the commands after
   * it that never ran.
   */
  batch_abandoned: {
    failed: Command;
    abandoned: readonly Command[];
    error: Error;
    timestamp: number;
  };
  /** Fired when one or more actions in a batch fail or are skipped. */
  action_error: {
    instanceId: InstanceId;
    action: ActionName;
    error: Error | undefined;
    timestamp: number;
  };
};

// Result of a single locally-invoked action's runner. `skipped` and
// `succeeded` are distinct from `failed` so the caller can revert an
// optimistic transition on `failed` only (a skip means no runner ran, so
// there is nothing to undo).
export type ActionInvocationOutcome = 'succeeded' | 'failed' | 'skipped';

/**
 * Processes commands through a sequential event loop.
 *
 * Each command is dispatched and processed in order.
 * Commands received during processing are queued and processed sequentially.
 *
 * Processes commands via a sequential event loop:
 * - `dispatch(...commands)` queues one or more Commands (multiple = atomic batch)
 * - `setLayout(layout)` convenience for SetLayoutCommand
 * - `executeActions(executionPlan)` convenience for ExecuteActionsCommand
 * - Runner registration is exposed via pass-through methods
 *
 * @example
 * ```ts
 * const processor = new CommandProcessor({ debug: true });
 *
 * processor.events.on('command_complete', (event) => {
 *   console.log(`Processed in ${event.duration}ms`);
 * });
 *
 * processor.dispatch({ kind: 'set_layout', layout: myLayout });
 * processor.executeActions(executionPlan);
 * ```
 */
export class CommandProcessor {
  readonly store: Store<CommandProcessingState>;
  readonly #emitter = new TypedEmitter<CommandProcessorEvents>();
  readonly events: EventSubscriber<CommandProcessorEvents> = this.#emitter;
  readonly #actionManager: ActionManager;
  readonly #logger: Logger;
  #commandQueue: Array<Command | Command[]> = [];
  #idleResolvers: Set<(result: Result<void, Error>) => void> = new Set();
  // Outlives the return to 'idle' so a wait issued after the fact still sees
  // the failure.
  #lastBurstError: Error | null = null;
  // Keyed by command identity so a locally-invoked action can await the
  // outcome of *its* execute_actions command specifically, even when other
  // commands (engine batches, other local invocations) interleave in the
  // queue. Settled in #processCommand once that command finishes.
  #actionResultResolvers = new Map<
    Command,
    (result: BatchExecutionResult | undefined) => void
  >();

  constructor(options: CommandProcessorOptions = {}) {
    const initialState =
      options.initialState ?? createInitialCommandProcessingState();
    this.store = new Store<CommandProcessingState>(initialState);
    this.#logger = new Logger(options.debug ?? false, 'CommandProcessor');
    this.#actionManager = new ActionManager({
      logger: this.#logger,
      readinessTimeoutMs: options.defaultActionWaitTimeoutMs,
      executionTimeoutMs: options.actionExecutionTimeoutMs,
    });
  }

  get queueLength(): number {
    return this.#commandQueue.length;
  }

  /**
   * Register an action runner for a specific instance.
   *
   * @param instanceId - The branded instance ID this runner handles
   * @param runner - Object with action name -> handler function mapping
   */
  registerRunner<V extends VesselDefinition>(
    instanceId: InstanceId,
    runner: ActionRunner<V>,
  ): Unsubscribe {
    return this.#actionManager.registerRunner(instanceId, runner);
  }

  /**
   * Returns a promise that resolves when the processor is idle and the
   * command queue is empty. Resolves immediately if already idle.
   *
   * The resolved {@link Result} reports whether the observed activity burst —
   * the run of commands between leaving idle and draining the queue — failed:
   * `ok` when every command in it completed, `err` with the most recent
   * failure otherwise. A refusal (such as a rejected `set_layout`) is
   * therefore visible to `dispatch(cmd); await waitForIdle();` without
   * subscribing to `processing_error` first: the error outlives the return
   * to idle and is only discarded when a new burst begins. Called while
   * already idle, it reports the outcome of the burst that most recently
   * completed (`ok` on a fresh processor).
   *
   * The queue is shared, so the Result describes the burst as a whole, not
   * any one caller's commands; concurrent waiters observe the same value. A
   * waiter is bound to the burst that was in flight when it was issued, so a
   * burst started from the return-to-idle notification itself cannot overwrite
   * its result. The promise never rejects, and disposal settles pending waiters
   * with the outcome recorded so far.
   */
  waitForIdle(): Promise<Result<void, Error>> {
    if (this.store.state.status === 'idle' && this.#commandQueue.length === 0) {
      return Promise.resolve(this.#snapshotBurstResult());
    }
    return new Promise((resolve) => {
      this.#idleResolvers.add(resolve);
    });
  }

  /**
   * Dispatch one or more commands for processing.
   * A single command is processed immediately (or queued).
   * Multiple commands form an atomic batch — processed sequentially
   * without returning to idle between them, and a command that throws
   * abandons the rest of its batch (`processing_error` names the failure,
   * `batch_abandoned` names what never ran). Commands dispatched separately
   * are independent: a failure in one does not stop the next.
   *
   * A failure is reported through the `processing_error` event and through
   * the `Result` that `waitForIdle()` resolves with.
   */
  dispatch(...commands: Command[]): void {
    if (commands.length === 0) return;
    if (commands.length === 1) {
      this.#enqueue(commands[0]);
      return;
    }
    this.#enqueue(commands);
  }

  #enqueue(item: Command | Command[]): void {
    if (this.#emitter.disposed) {
      throw new Error('CommandProcessor is disposed');
    }

    if (this.store.state.status !== 'idle') {
      this.#commandQueue.push(item);
      return;
    }

    void this.#runEventLoop(item);
  }

  /**
   * Convenience method to dispatch a SetLayoutCommand.
   *
   * The layout can be refused — a tiling tree that names the same instance in
   * two slots is rejected — and a refusal neither throws nor rejects a
   * promise, because the layout is applied after this call returns. Subscribe
   * to the `processing_error` event to detect one; dispatched as part of a
   * batch, a refusal also emits `batch_abandoned`. A refused layout (duplicate
   * tiling leaf, malformed weight token) leaves the previous layout in place;
   * observe the refusal via `waitForIdle()` or `processing_error`.
   *
   * @param layout - The layout to apply
   */
  setLayout(layout: GridLayout | TilingLayout): void {
    this.dispatch({ kind: 'set_layout', layout });
  }

  /**
   * Convenience method to dispatch an ExecuteActionsCommand.
   *
   * The actions run after this call returns, so neither a failing action nor
   * a failing command throws or rejects a promise here. Subscribe to
   * `action_error` for an individual action and to `processing_error` for the
   * command as a whole.
   *
   * @param executionPlan - The actions to execute
   */
  executeActions(executionPlan: readonly ActionExecution[]): void {
    this.dispatch({ kind: 'execute_actions', executionPlan });
  }

  /**
   * Last-write-wins variant swap. Applies `next` only if the instance still
   * exists and its variant is exactly `expected`; returns whether it applied.
   * The guard is what makes an optimistic-transition revert safe: a newer
   * local invocation or an engine layout landing in between must not be
   * clobbered.
   */
  setVariantIfCurrent(
    instanceId: InstanceId,
    expected: VariantName,
    next: VariantName,
  ): boolean {
    let applied = false;
    this.store.setState((state) => {
      const instance = state.instances.get(instanceId);
      if (!instance || instance.variant !== expected) return state;
      applied = true;
      const instances = new Map(state.instances);
      instances.set(instanceId, { ...instance, variant: next });
      return { ...state, instances };
    });
    return applied;
  }

  /**
   * Runs a single action through the same queue + ActionManager machinery as
   * an engine execution plan (readiness wait, execution timeout, action_error
   * emission) and resolves with that action's outcome so a caller can arbitrate
   * an optimistic-transition revert. Does not throw.
   */
  runLocalAction(execution: ActionExecution): Promise<ActionInvocationOutcome> {
    if (this.#emitter.disposed) return Promise.resolve('failed');

    const command: ExecuteActionsCommand = {
      kind: 'execute_actions',
      executionPlan: [execution],
    };
    const settled = new Promise<BatchExecutionResult | undefined>((resolve) => {
      this.#actionResultResolvers.set(command, resolve);
    });
    this.dispatch(command);

    return settled.then((result) => {
      const record = result?.actions[0];
      if (!record) return 'failed';
      if (record.skipped) return 'skipped';
      return record.result.ok ? 'succeeded' : 'failed';
    });
  }

  dispose(): void {
    if (this.#emitter.disposed) return;

    this.#emitter.dispose();
    this.#commandQueue = [];
    this.#actionManager.dispose();

    // Resolve any pending waitForIdle promises so they don't hang
    this.#settleIdleWaiters();

    // Settle any in-flight runLocalAction awaiters (undefined → 'failed') so
    // they don't hang past disposal.
    for (const resolve of this.#actionResultResolvers.values()) {
      resolve(undefined);
    }
    this.#actionResultResolvers.clear();
  }

  async #runEventLoop(firstItem: Command | Command[]): Promise<void> {
    this.#lastBurstError = null;
    let currentItem: Command | Command[] | null = firstItem;

    while (currentItem) {
      if (Array.isArray(currentItem)) {
        // A batch is atomic to its producer: a set_layout is paired with the
        // execute_actions that targets the instances that layout creates.
        // Running the tail after the head threw would execute those actions
        // against the pre-command store — every action waiting out its
        // readiness timeout, recording as `skipped` with an `ok` result, and
        // the batch reporting zero failures. Abandon instead, and say which
        // commands were abandoned.
        for (const [index, command] of currentItem.entries()) {
          const outcome = await this.#processCommand(command);
          if (!outcome.ok) {
            this.#abandonBatch(
              command,
              currentItem.slice(index + 1),
              outcome.error,
            );
            break;
          }
        }
      } else {
        // Discarding the outcome is the handling: a command dispatched alone
        // has no batch tail to abandon, and `processing_error` has already
        // named the failure.
        await this.#processCommand(currentItem);
      }

      currentItem = this.#dequeueNext();
    }
  }

  #abandonBatch(
    failed: Command,
    abandoned: readonly Command[],
    error: Error,
  ): void {
    if (abandoned.length === 0) return;

    this.#logger.error(
      `Abandoning ${abandoned.length} command(s) after ${failed.kind} failed: ${abandoned.map((c) => c.kind).join(', ')}`,
    );

    // Forward-cover, not a live hazard: today only runLocalAction registers a
    // resolver, and it dispatches its command alone, so no batch element can
    // carry one. If runLocalAction commands ever get batched, settle here
    // before the event (undefined → 'failed', which reverts an optimistic
    // transition rather than assuming success).
    for (const command of abandoned) {
      this.#settleActionResult(command, undefined);
    }

    this.#emitter.emit('batch_abandoned', {
      failed,
      abandoned,
      error,
      timestamp: performance.now(),
    });
  }

  // The signal #runEventLoop needs to abandon the rest of an atomic batch.
  async #processCommand(command: Command): Promise<Result<void, Error>> {
    const startTime = performance.now();

    this.#logger.info(`Processing command: ${command.kind}`);

    this.store.setState((state) => ({
      ...state,
      status: 'processing' as const,
      lastError: null,
    }));

    this.#emitter.emit('command_start', {
      command,
      timestamp: performance.now(),
    });

    let actionResult: BatchExecutionResult | undefined;
    let outcome: Result<void, Error> = ok(undefined);
    try {
      switch (command.kind) {
        case 'set_layout': {
          if (command.layout.type === 'tiling') {
            assertNoDuplicateTilingLeaf(command.layout);
          }
          const newInstances = applyLayout(
            command.layout,
            this.store.state.instances,
          );
          this.store.setState((s) => ({
            ...s,
            layout: command.layout,
            instances: newInstances,
          }));
          break;
        }
        case 'execute_actions': {
          actionResult = await this.#actionManager.executeActions(
            command.executionPlan,
          );
          for (const record of actionResult.actions) {
            if (!record.result.ok) {
              this.#emitter.emit('action_error', {
                instanceId: record.instanceId,
                action: record.action,
                error: record.result.error,
                timestamp: performance.now(),
              });
            }
          }
          break;
        }
      }
    } catch (error) {
      this.#logger.error('Error processing command:', error);
      const errorObj = toError(error);
      outcome = err(errorObj);
      this.#lastBurstError = errorObj;
      this.store.setState((state) => ({
        ...state,
        status: 'error' as const,
        lastError: errorObj,
      }));

      this.#emitter.emit('processing_error', {
        command,
        error: errorObj,
        timestamp: performance.now(),
      });
    }

    this.#emitter.emit('command_complete', {
      command,
      duration: performance.now() - startTime,
      timestamp: performance.now(),
    });

    // A thrown command leaves actionResult undefined → the awaiter resolves
    // 'failed' (safe: revert an optimistic transition rather than assume
    // success on a command that never produced a result).
    this.#settleActionResult(command, actionResult);

    return outcome;
  }

  #dequeueNext(): Command | Command[] | null {
    if (this.#commandQueue.length > 0) {
      return this.#commandQueue.shift() ?? null;
    }

    // Settle before publishing 'idle': a subscriber can synchronously dispatch
    // from that notification, and the burst it starts resets #lastBurstError.
    // Waiters on the burst that just drained would then read the reset value
    // and report a clean run over a refusal.
    this.#settleIdleWaiters();

    this.store.setState((state) => ({
      ...state,
      status: 'idle' as const,
    }));

    return null;
  }

  #settleIdleWaiters(): void {
    if (this.#idleResolvers.size === 0) return;

    const result = this.#snapshotBurstResult();
    const resolvers = [...this.#idleResolvers];
    this.#idleResolvers.clear();
    for (const resolve of resolvers) {
      resolve(result);
    }
  }

  #settleActionResult(
    command: Command,
    result: BatchExecutionResult | undefined,
  ): void {
    const resolve = this.#actionResultResolvers.get(command);
    if (!resolve) return;
    this.#actionResultResolvers.delete(command);
    resolve(result);
  }

  #snapshotBurstResult(): Result<void, Error> {
    return this.#lastBurstError ? err(this.#lastBurstError) : ok(undefined);
  }
}

/**
 * Refuses a tiling layout that names the same Instance in two tree slots.
 *
 * An Instance is one entry in the store with one Variant and one action
 * surface, and tiles are keyed by Instance ID, so a repeated leaf describes
 * something the renderer cannot draw. Weighted split tokens replace the only
 * reason a producer ever had to repeat a leaf — claiming more space — so the
 * repeat is a producer bug rather than an intent worth repairing.
 */
function assertNoDuplicateTilingLeaf(layout: TilingLayout): void {
  const duplicate = findDuplicateTilingLeaves(layout.tree).at(0);
  if (duplicate === undefined) return;

  throw new Error(
    `set_layout rejected: tiling tree ${describeDuplicateTilingLeaf(duplicate)}`,
  );
}
