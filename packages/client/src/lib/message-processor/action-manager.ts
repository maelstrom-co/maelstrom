import {
  type ActionExecution,
  Success,
  type Vessel,
} from '@maelstrom/protocol';

import { isPromise } from '../types.js';
import { Logger } from '../utils/logger.js';
import type {
  ActionRecord,
  ActionRunner,
  AnyActionRunner,
  BatchExecutionResult,
  ExecutableAction,
} from './action-runner.types.js';

/**
 * ActionManager handles action execution for vessel instances.
 *
 * Components register typed action runners per instance to handle actions.
 * Actions are executed:
 * - In parallel across different instances
 * - Sequentially within the same instance (respects executionPlan order)
 *
 * The manager includes a waitForReady mechanism to handle race conditions
 * where the server sends actions before components have registered their runners.
 *
 * @example
 * ```typescript
 * const store = new Store(createInitialState());
 * const actionManager = new ActionManager();
 *
 * // Register typed action handlers for a specific instance
 * actionManager.registerRunner('instance-1', {
 *   selectOrder: async (params) => {
 *     // params is fully typed based on vessel definition
 *     setSelectedOrderId(params.orderId);
 *     return Success();
 *   },
 *   closeOrderDetails: async () => {
 *     setSelectedOrderId(null);
 *     return Success();
 *   },
 * });
 *
 * // Execute actions from a server response
 * const result = await actionManager.executeActions(response.executionPlan);
 * console.log(`Executed ${result.actions.length} actions`);
 * ```
 */
export class ActionManager {
  #runners: Map<string, AnyActionRunner> = new Map();
  #readinessWaiters: Map<string, Set<() => void>> = new Map();
  #logger: Logger;
  #defaultTimeoutMs: number;

  constructor(options?: {
    logger?: Logger;
    defaultTimeoutMs?: number | undefined;
  }) {
    this.#logger = options?.logger ?? new Logger(false);
    this.#defaultTimeoutMs = options?.defaultTimeoutMs ?? 500;
  }

  /**
   * Register an action runner for a specific instance.
   * The runner is an object with typed action handlers.
   *
   * @param instanceId - The instance ID this runner handles
   * @param runner - Object with action name -> handler function mapping
   * @example
   * ```typescript
   * actionManager.registerRunner('instance-1', {
   *   selectOrder: async (params) => {
   *     setSelectedOrderId(params.orderId);
   *     return { success: true, value: undefined };
   *   },
   * });
   * ```
   */
  registerRunner<V extends Vessel>(
    instanceId: string,
    runner: ActionRunner<V>,
  ): void {
    this.#runners.set(instanceId, runner as AnyActionRunner);
    this.#logger.info(`Registered runner for instance "${instanceId}"`);

    // Resolve any waiters waiting for this instance
    const waiters = this.#readinessWaiters.get(instanceId);
    if (waiters) {
      for (const resolve of waiters) {
        resolve();
      }
      this.#readinessWaiters.delete(instanceId);
    }
  }

  /**
   * Unregister a runner for an instance.
   *
   * @param instanceId - The instance ID to unregister
   */
  unregisterRunner(instanceId: string): void {
    this.#runners.delete(instanceId);
    this.#logger.info(`Unregistered runner for instance "${instanceId}"`);
  }

  /**
   * Check if a runner is registered for an instance.
   *
   * @param instanceId - The instance ID to check
   * @returns true if a runner is registered
   */
  hasRunner(instanceId: string): boolean {
    return this.#runners.has(instanceId);
  }

  /**
   * Get all registered instance IDs.
   *
   * @returns Array of instance IDs with registered runners
   */
  getRegisteredInstances(): string[] {
    return Array.from(this.#runners.keys());
  }

  /**
   * Wait for a runner to be registered for an instance.
   * This handles the race condition where the server sends actions
   * before React components have mounted and registered their runners.
   *
   * @param instanceId - The instance ID to wait for
   * @param timeoutMs - Maximum time to wait (default: 5000ms)
   * @returns Promise that resolves to true if runner registered, false if timeout
   *
   * @example
   * ```typescript
   * const isReady = await actionManager.waitForReady('instance-1', 3000);
   * if (isReady) {
   *   // Runner is available, actions can execute
   * }
   * ```
   */
  async waitForReady(
    instanceId: string,
    timeoutMs: number = 5000,
  ): Promise<boolean> {
    // Check if already registered
    if (this.#runners.has(instanceId)) {
      return true;
    }

    this.#logger.debug(
      `Waiting for runner for instance "${instanceId}" (timeout: ${timeoutMs}ms)`,
    );

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.#cleanupWaiter(instanceId, waiter);
        this.#logger.warn(
          `Timeout waiting for runner for instance "${instanceId}" after ${timeoutMs}ms`,
        );
        resolve(false);
      }, timeoutMs);

      const waiter = () => {
        clearTimeout(timeoutId);
        this.#cleanupWaiter(instanceId, waiter);
        this.#logger.debug(`Runner for instance "${instanceId}" is now ready`);
        resolve(true);
      };

      // Add to waiters
      let waiters = this.#readinessWaiters.get(instanceId);
      if (!waiters) {
        waiters = new Set();
        this.#readinessWaiters.set(instanceId, waiters);
      }
      waiters.add(waiter);
    });
  }

  /**
   * Execute all actions in the execution plan.
   *
   * Actions are grouped by instance and executed:
   * - In parallel across different instances
   * - Sequentially within the same instance (respects executionPlan order)
   *
   * Waits for runners to be ready before executing. Actions are skipped if
   * no runner is registered within the timeout.
   *
   * @param executionPlan - Array of actions to execute
   * @returns Result of the batch execution
   */
  async executeActions<V extends Vessel = Vessel, Name extends string = string>(
    executionPlan: ActionExecution<V, Name>[],
  ): Promise<BatchExecutionResult> {
    if (executionPlan.length === 0) {
      return {
        actions: [],
        allSucceeded: true,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
      };
    }

    // Group actions by instance ID
    const actionsByInstance = this.#groupActionsByInstance(executionPlan);

    this.#logger.debug(
      `Executing ${executionPlan.length} actions across ${actionsByInstance.size} instances`,
    );

    // Execute each instance's actions in parallel
    const instanceResults = await Promise.all(
      Array.from(actionsByInstance.entries()).map(
        async ([instanceId, actionDefs]) => {
          // Wait for runner to be ready before executing
          const isReady = await this.waitForReady(
            instanceId,
            this.#defaultTimeoutMs,
          );

          if (!isReady) {
            this.#logger.warn(
              `No runner registered for instance "${instanceId}", skipping ${actionDefs.length} actions`,
            );
            // Return skipped actions (not a failure)
            return actionDefs.map((a) => ({
              instanceId,
              action: a.execution.action,
              result: Success(undefined),
              duration: 0,
              skipped: true,
            }));
          }

          // Get the runner now that we're ready
          const runner = this.#getRunnerForInstance(instanceId);
          const actions: ExecutableAction<V, Name>[] = actionDefs.map((a) => ({
            execution: a.execution,
            runner,
          }));

          return this.#executeInstanceActions(instanceId, actions);
        },
      ),
    );

    // Combine all action records
    const allActions = instanceResults.flat();

    const successCount = allActions.filter(
      (a) => a.result.success && !a.skipped,
    ).length;
    const skippedCount = allActions.filter((a) => a.skipped).length;
    const failureCount = allActions.length - successCount - skippedCount;

    this.#logger.info(
      `Actions complete: ${successCount} succeeded, ${failureCount} failed, ${skippedCount} skipped`,
    );

    return {
      actions: allActions,
      allSucceeded: failureCount === 0,
      successCount,
      failureCount,
      skippedCount,
    };
  }

  /**
   * Cleanup a waiter from the waiters map.
   */
  #cleanupWaiter(instanceId: string, waiter: () => void): void {
    const waiters = this.#readinessWaiters.get(instanceId);
    if (!waiters) return;

    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.#readinessWaiters.delete(instanceId);
    }
  }

  /**
   * Group actions by their target instance ID.
   * Also looks up runners for each instance.
   */
  #groupActionsByInstance<
    V extends Vessel = Vessel,
    Name extends string = string,
  >(
    executionPlan: ActionExecution<V, Name>[],
  ): Map<string, ExecutableAction<V, Name>[]> {
    const grouped = new Map<string, ExecutableAction<V, Name>[]>();

    for (const execution of executionPlan) {
      const { instanceId } = execution;
      const runner = this.#getRunnerForInstance(instanceId);

      if (!grouped.has(instanceId)) {
        grouped.set(instanceId, []);
      }

      grouped.get(instanceId)?.push({ execution, runner });
    }

    return grouped;
  }

  /**
   * Get the runner for a specific instance.
   * Looks up the runner directly by instanceId.
   */
  #getRunnerForInstance(instanceId: string): AnyActionRunner | undefined {
    return this.#runners.get(instanceId);
  }

  /**
   * Execute all actions for a single instance sequentially.
   * Actions are executed in the order they appear in the array.
   */
  async #executeInstanceActions<
    V extends Vessel = Vessel,
    Name extends string = string,
  >(
    instanceId: string,
    actions: ExecutableAction<V, Name>[],
  ): Promise<ActionRecord[]> {
    const records: ActionRecord[] = [];

    for (const { execution, runner } of actions) {
      const startTime = performance.now();

      if (!runner) {
        // Should not happen since we wait for ready, but just in case
        this.#logger.warn(
          `No runner available for instance "${instanceId}" action "${execution.action}", skipping`,
        );
        records.push({
          instanceId,
          action: execution.action,
          result: Success(undefined),
          duration: 0,
          skipped: true,
        });
        continue;
      }

      // Look up the specific handler for this action
      const handler = runner[execution.action];
      if (!handler) {
        this.#logger.warn(
          `No handler for action "${execution.action}" on instance "${instanceId}", skipping`,
        );
        records.push({
          instanceId,
          action: execution.action,
          result: Success(undefined),
          duration: 0,
          skipped: true,
        });
        continue;
      }

      try {
        this.#logger.debug(
          `Executing action "${execution.action}" on instance "${instanceId}"`,
        );

        const handlerResult = handler(execution.params);

        // Handle both sync (Result) and async (Promise<Result>) handlers
        // without unnecessary Promise wrapping overhead for sync handlers
        const result = isPromise(handlerResult)
          ? await handlerResult
          : handlerResult;

        const duration = performance.now() - startTime;

        this.#logger.debug(
          `Action "${execution.action}" completed on instance "${instanceId}" (${duration.toFixed(2)}ms)`,
        );

        records.push({
          instanceId,
          action: execution.action,
          result,
          duration,
        });
      } catch (error) {
        const duration = performance.now() - startTime;

        this.#logger.error(
          `Action "${execution.action}" failed on instance "${instanceId}":`,
          error instanceof Error ? error.message : String(error),
        );

        records.push({
          instanceId,
          action: execution.action,
          result: {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          },
          duration,
        });
      }
    }

    return records;
  }
}
