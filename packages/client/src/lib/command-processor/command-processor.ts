import type {
  ActionExecution,
  ActionName,
  GridLayout,
  InstanceId,
  TilingLayout,
  VariantName,
  VesselDefinition,
} from '@maelstrom-co/protocol';
import { findDuplicateTilingLeaf, toError } from '@maelstrom-co/protocol';
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
  #idleResolvers: Set<() => void> = new Set();
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
   * Returns a promise that resolves when the processor is idle
   * and the command queue is empty.
   *
   * Resolves immediately if already idle.
   */
  waitForIdle(): Promise<void> {
    if (this.store.state.status === 'idle' && this.#commandQueue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const cleanup = () => {
        sub.unsubscribe();
        this.#idleResolvers.delete(resolve);
      };
      const sub = this.store.subscribe(() => {
        if (
          this.store.state.status === 'idle' &&
          this.#commandQueue.length === 0
        ) {
          cleanup();
          resolve();
        }
      });
      this.#idleResolvers.add(resolve);
    });
  }

  /**
   * Dispatch one or more commands for processing.
   * A single command is processed immediately (or queued).
   * Multiple commands form an atomic batch — processed sequentially
   * without returning to idle between them.
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
   * @param layout - The layout to apply
   */
  setLayout(layout: GridLayout | TilingLayout): void {
    this.dispatch({ kind: 'set_layout', layout });
  }

  /**
   * Convenience method to dispatch an ExecuteActionsCommand.
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

    // Resolve any pending waitForIdle promises so they don't hang
    for (const resolve of this.#idleResolvers) {
      resolve();
    }
    this.#idleResolvers.clear();

    // Settle any in-flight runLocalAction awaiters (undefined → 'failed') so
    // they don't hang past disposal.
    for (const resolve of this.#actionResultResolvers.values()) {
      resolve(undefined);
    }
    this.#actionResultResolvers.clear();
  }

  async #runEventLoop(firstItem: Command | Command[]): Promise<void> {
    let currentItem: Command | Command[] | null = firstItem;

    while (currentItem) {
      if (Array.isArray(currentItem)) {
        for (const command of currentItem) {
          await this.#processCommand(command);
        }
      } else {
        await this.#processCommand(currentItem);
      }

      currentItem = this.#dequeueNext();
    }
  }

  async #processCommand(command: Command): Promise<void> {
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
    try {
      switch (command.kind) {
        case 'set_layout': {
          assertNoDuplicateTilingLeaf(command.layout);
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
    const resolve = this.#actionResultResolvers.get(command);
    if (resolve) {
      this.#actionResultResolvers.delete(command);
      resolve(actionResult);
    }
  }

  #dequeueNext(): Command | Command[] | null {
    if (this.#commandQueue.length > 0) {
      return this.#commandQueue.shift() ?? null;
    }

    this.store.setState((state) => ({
      ...state,
      status: 'idle' as const,
    }));

    return null;
  }
}

/**
 * Refuses a tiling layout that names the same Instance in two tree slots.
 *
 * An Instance is one entry in the store with one Variant and one action
 * surface, and tiles are keyed by Instance ID, so a repeated leaf describes
 * something the renderer cannot draw. Weighted split tokens replace the only
 * reason a producer ever had to repeat a leaf — claiming more space — so the
 * repeat is now unambiguously a producer bug.
 *
 * Throwing rather than repairing is deliberate: `#processCommand` converts it
 * into a `processing_error` event and leaves the store untouched, so the
 * previously rendered layout stays on screen. The failure mode is "the layout
 * did not update, plus an error event", never a blank chart.
 */
function assertNoDuplicateTilingLeaf(layout: GridLayout | TilingLayout): void {
  if (layout.type !== 'tiling') return;

  const duplicate = findDuplicateTilingLeaf(layout.tree);
  if (!duplicate) return;

  throw new Error(
    `set_layout rejected: tiling tree names instance "${duplicate.instanceId}" more than once (tree index ${duplicate.atTokenIndex}). An instance renders as exactly one tile — weight the split token instead of repeating the leaf.`,
  );
}
