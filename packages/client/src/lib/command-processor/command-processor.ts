import type {
  ActionExecution,
  GridLayout,
  InstanceId,
  TilingLayout,
  VesselDefinition,
} from '@maelstrom-co/protocol';
import { toError } from '@maelstrom-co/protocol';
import { Store } from '@tanstack/store';

import type { Unsubscribe } from '../types.js';
import { Logger } from '../utils/logger.js';
import { type EventSubscriber, TypedEmitter } from '../utils/typed-emitter.js';
import { ActionManager } from './action-manager.js';
import type { ActionRunner } from './action-runner.types.js';
import type { Command } from './command.types.js';
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
    action: string;
    error: Error | undefined;
    timestamp: number;
  };
};

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

  dispose(): void {
    if (this.#emitter.disposed) return;

    this.#emitter.dispose();
    this.#commandQueue = [];

    // Resolve any pending waitForIdle promises so they don't hang
    for (const resolve of this.#idleResolvers) {
      resolve();
    }
    this.#idleResolvers.clear();
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

    try {
      switch (command.kind) {
        case 'set_layout': {
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
          const result = await this.#actionManager.executeActions(
            command.executionPlan,
          );
          for (const record of result.actions) {
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
