import {
  type ActionExecution,
  type ActionName,
  err,
  type InstanceId,
  ok,
  toError,
  type VariantName,
  type VesselDefinition,
  type VesselId,
} from '@maelstrom-co/protocol';

import { isPromise, type Unsubscribe } from '../types.js';
import { Logger } from '../utils/logger.js';
import { notifyObserver } from '../utils/notify-observer.js';
import type {
  ActionRecord,
  ActionRunner,
  AnyActionRunner,
  BatchExecutionResult,
  ExecutableAction,
} from './action-runner.types.js';

/** One readiness or execution stage observed without changing Action behavior. */
export interface ActionProgress {
  /** Target Instance. */ readonly instanceId: InstanceId;
  /** Action name when a specific handler starts. */ readonly action?: ActionName;
  /** Readiness and execution are distinct stages. */ readonly phase:
    | 'waiting'
    | 'ready'
    | 'unavailable'
    | 'started';
  /** Local elapsed duration for readiness. */ readonly durationMs?: number;
}

/**
 * How an Action resolves against its Instance's Variant at the moment the
 * Action's turn comes.
 *
 * - `available`: the Action is defined on `variant`, the Instance's current
 *   Variant, and `transition` describes its declared `transitionsTo`.
 * - `instance_missing`: the Instance is not in the store.
 * - `vessel_unknown`: no Vessel definition is registered for the Instance.
 * - `action_not_on_variant`: the current Variant does not define the Action.
 */
export type ActionVariantResolution =
  | {
      /** The Action is defined on the current Variant. */
      readonly status: 'available';
      /** The Instance's Variant before this Action runs. */
      readonly variant: VariantName;
      /** The Action's declared Variant transition on `variant`. */
      readonly transition: ActionVariantTransition;
    }
  | {
      /** The Instance is not in the store. */
      readonly status: 'instance_missing';
    }
  | {
      /** The Instance's Vessel has no registered definition. */
      readonly status: 'vessel_unknown';
      /** The unregistered Vessel. */
      readonly vesselId: VesselId;
      /** The Instance's current Variant. */
      readonly variant: VariantName;
    }
  | {
      /** The current Variant does not define the Action. */
      readonly status: 'action_not_on_variant';
      /** The Instance's current Variant. */
      readonly variant: VariantName;
    };

/**
 * The `transitionsTo` an Action declares on the Variant it runs from.
 *
 * - `none`: the Action declares no transition.
 * - `to`: the Action moves the Instance to `variant`, a Variant of its Vessel.
 * - `unknown_target`: the Action names `target`, which its Vessel does not
 *   define, so no transition can apply.
 */
export type ActionVariantTransition =
  | {
      /** No transition is declared. */
      readonly kind: 'none';
    }
  | {
      /** The Action transitions to a defined Variant. */
      readonly kind: 'to';
      /** The Variant the Action moves the Instance to. */
      readonly variant: VariantName;
    }
  | {
      /** The Action transitions to a Variant its Vessel does not define. */
      readonly kind: 'unknown_target';
      /** The undefined Variant name as declared. */
      readonly target: string;
    };

/**
 * Lets {@link ActionManager.executeActions} resolve each Action against the
 * Instance's current Variant and apply the Action's `transitionsTo`.
 *
 * {@link CommandProcessor} builds one from its store and Vessel registry.
 */
export interface VariantTransitions {
  /**
   * Reads the Instance's current Variant and the named Action's declaration
   * on it. Called once per Action, at that Action's turn.
   *
   * @param instanceId - The Instance the Action targets.
   * @param action - The Action about to run.
   * @returns The Variant and declared transition, or why the Action is
   * unavailable.
   */
  resolve(instanceId: InstanceId, action: ActionName): ActionVariantResolution;
  /**
   * Compare-and-set: moves the Instance to `next` only while its Variant is
   * still `expected`.
   *
   * @param instanceId - The Instance to transition.
   * @param expected - The Variant the Action started from.
   * @param next - The Variant the Action transitions to.
   * @returns Whether the transition applied. `false` means a newer write won.
   */
  apply(
    instanceId: InstanceId,
    expected: VariantName,
    next: VariantName,
  ): boolean;
}

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
 * Given {@link VariantTransitions}, each Action resolves against the
 * Instance's Variant at its turn and applies its `transitionsTo` after the
 * handler succeeds. A transition with no handler applies on its own. Without
 * them, handlers are looked up by name alone and no Variant changes.
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
 *     return ok(undefined);
 *   },
 *   closeOrderDetails: async () => {
 *     setSelectedOrderId(null);
 *     return ok(undefined);
 *   },
 * });
 *
 * // Execute actions from a server response
 * const result = await actionManager.executeActions(response.executionPlan);
 * console.log(`Executed ${result.actions.length} actions`);
 * ```
 */

export class ActionManager {
  #runners: Map<InstanceId, AnyActionRunner> = new Map();
  #readinessWaiters: Map<InstanceId, Set<(ready: boolean) => void>> = new Map();
  #logger: Logger;
  #readinessTimeoutMs: number;
  #executionTimeoutMs: number;
  #disposed = false;

  constructor(options?: {
    logger?: Logger;
    readinessTimeoutMs?: number | undefined;
    executionTimeoutMs?: number | undefined;
  }) {
    this.#logger = options?.logger ?? new Logger(false);
    this.#readinessTimeoutMs = options?.readinessTimeoutMs ?? 500;
    this.#executionTimeoutMs = options?.executionTimeoutMs ?? 30_000;
  }

  /**
   * Register an action runner for a specific instance.
   * The runner is an object with typed action handlers.
   *
   * @param instanceId - The branded instance ID this runner handles
   * @param runner - Object with action name -> handler function mapping
   * @example
   * ```typescript
   * actionManager.registerRunner(InstanceId('instance-1'), {
   *   selectOrder: async (params) => {
   *     setSelectedOrderId(params.orderId);
   *     return ok(undefined);
   *   },
   * });
   * ```
   */
  registerRunner<V extends VesselDefinition>(
    instanceId: InstanceId,
    runner: ActionRunner<V>,
  ): Unsubscribe {
    const registeredRunner = runner as AnyActionRunner;
    this.#runners.set(instanceId, registeredRunner);
    this.#logger.info(`Registered runner for instance "${instanceId}"`);

    // Resolve any waiters waiting for this instance
    const waiters = this.#readinessWaiters.get(instanceId);
    if (waiters) {
      for (const settle of waiters) {
        settle(true);
      }
      this.#readinessWaiters.delete(instanceId);
    }

    // Return disposer that checks identity before removal
    return () => {
      if (this.#runners.get(instanceId) === registeredRunner) {
        this.#runners.delete(instanceId);
        this.#logger.info(`Disposed runner for instance "${instanceId}"`);
      } else {
        this.#logger.debug(
          `Dispose skipped for instance "${instanceId}": runner identity changed`,
        );
      }
    };
  }

  /**
   * Check if a runner is registered for an instance.
   *
   * @param instanceId - The branded instance ID to check
   * @returns true if a runner is registered
   */
  hasRunner(instanceId: InstanceId): boolean {
    return this.#runners.has(instanceId);
  }

  /**
   * Get all registered instance IDs.
   *
   * @returns Array of instance IDs with registered runners
   */
  getRegisteredInstances(): InstanceId[] {
    return Array.from(this.#runners.keys());
  }

  /**
   * Wait for a runner to be registered for an instance.
   * This handles the race condition where the server sends actions
   * before React components have mounted and registered their runners.
   *
   * @param instanceId - The branded instance ID to wait for
   * @param timeoutMs - Maximum time to wait (default: 5000ms)
   * @returns Promise that resolves to true if runner registered, false if the
   * wait timed out or the manager was disposed
   *
   * @example
   * ```typescript
   * const isReady = await actionManager.waitForReady(InstanceId('instance-1'), 3000);
   * if (isReady) {
   *   // Runner is available, actions can execute
   * }
   * ```
   */
  async waitForReady(
    instanceId: InstanceId,
    timeoutMs: number = 5000,
  ): Promise<boolean> {
    // Check if already registered
    if (this.#runners.has(instanceId)) {
      return true;
    }

    if (this.#disposed) {
      return false;
    }

    this.#logger.debug(
      `Waiting for runner for instance "${instanceId}" (timeout: ${timeoutMs}ms)`,
    );

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.#warn(
          `Timeout waiting for runner for instance "${instanceId}" after ${timeoutMs}ms`,
        );
        settle(false);
      }, timeoutMs);

      const settle = (ready: boolean) => {
        clearTimeout(timeoutId);
        this.#cleanupWaiter(instanceId, settle);
        if (ready) {
          this.#logger.debug(
            `Runner for instance "${instanceId}" is now ready`,
          );
        }
        resolve(ready);
      };

      // Add to waiters
      let waiters = this.#readinessWaiters.get(instanceId);
      if (!waiters) {
        waiters = new Set();
        this.#readinessWaiters.set(instanceId, waiters);
      }
      waiters.add(settle);
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
   * With `transitions`, each Action in turn:
   * 1. Reads the Instance's runner, waiting for readiness again if it went
   *    away mid-sequence. A runner that never returns skips the Action as
   *    `readiness`.
   * 2. Resolves against the Instance's current Variant. An Action not defined
   *    there is skipped as `application`, with a `reason`.
   * 3. Runs its handler, if the runner has one. A failed handler applies no
   *    transition.
   * 4. Applies its `transitionsTo` with compare-and-set against the Variant
   *    from step 2. A transition with no handler counts as applied. A target
   *    equal to the current Variant, or one the Vessel does not define,
   *    applies nothing. A lost compare-and-set is not an error.
   *
   * Without `transitions`, handlers are looked up by name alone and no
   * Variant changes.
   *
   * @param executionPlan - Array of actions to execute
   * @param observe - Receives readiness and handler start progress
   * @param transitions - Resolves Actions per Variant and applies transitions
   * @returns Result of the batch execution
   */
  async executeActions(
    executionPlan: readonly ActionExecution[],
    observe?: (progress: ActionProgress) => void,
    transitions?: VariantTransitions,
  ): Promise<BatchExecutionResult> {
    const report = observe
      ? (progress: ActionProgress) => notifyObserver(observe, progress)
      : undefined;
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
          const readinessStart = performance.now();
          report?.({ instanceId, phase: 'waiting' });
          const isReady = await this.waitForReady(
            instanceId,
            this.#readinessTimeoutMs,
          );

          report?.({
            instanceId,
            phase: isReady ? 'ready' : 'unavailable',
            durationMs: performance.now() - readinessStart,
          });
          if (!isReady) {
            this.#warn(
              `No runner registered for instance "${instanceId}", skipping ${actionDefs.length} actions`,
            );
            // Return skipped actions (not a failure)
            return actionDefs.map((a) => ({
              instanceId,
              action: a.execution.action,
              result: ok(undefined),
              duration: 0,
              skipped: true,
              errorCategory: 'readiness' as const,
            }));
          }

          if (transitions) {
            return this.#executeInstanceActionsWithTransitions(
              instanceId,
              actionDefs.map((a) => a.execution),
              transitions,
              report,
            );
          }

          // Get the runner now that we're ready
          const runner = this.#getRunnerForInstance(instanceId);
          const actions: ExecutableAction[] = actionDefs.map((a) => ({
            execution: a.execution,
            runner,
          }));

          return this.#executeInstanceActions(instanceId, actions, report);
        },
      ),
    );

    // Combine all action records
    const allActions = instanceResults.flat();

    const successCount = allActions.filter(
      (a) => a.result.ok && !a.skipped,
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
   * Release the manager: cancel every pending readiness wait so no timer
   * outlives disposal, and settle its waiters as not-ready.
   *
   * Waiters resolve `false` rather than rejecting so an in-flight
   * {@link executeActions} still returns its actions as skipped instead of
   * surfacing a rejection its callers do not expect. A disposed manager stays
   * silent and never schedules another readiness timer.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;

    const pending = Array.from(this.#readinessWaiters.values());
    this.#readinessWaiters.clear();
    for (const waiters of pending) {
      for (const settle of waiters) {
        settle(false);
      }
    }
  }

  /**
   * Cleanup a waiter from the waiters map.
   */
  #cleanupWaiter(
    instanceId: InstanceId,
    waiter: (ready: boolean) => void,
  ): void {
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
  #groupActionsByInstance(
    executionPlan: readonly ActionExecution[],
  ): Map<InstanceId, ExecutableAction[]> {
    const grouped = new Map<InstanceId, ExecutableAction[]>();

    for (const execution of executionPlan) {
      const id = execution.instanceId;
      const runner = this.#getRunnerForInstance(id);

      if (!grouped.has(id)) {
        grouped.set(id, []);
      }

      grouped.get(id)?.push({ execution, runner });
    }

    return grouped;
  }

  /**
   * Get the runner for a specific instance.
   * Looks up the runner directly by instanceId.
   */
  #getRunnerForInstance(instanceId: InstanceId): AnyActionRunner | undefined {
    return this.#runners.get(instanceId);
  }

  /**
   * Execute all actions for a single instance sequentially.
   * Actions are executed in the order they appear in the array.
   */
  async #executeInstanceActions(
    instanceId: InstanceId,
    actions: ExecutableAction[],
    observe?: (progress: ActionProgress) => void,
  ): Promise<ActionRecord[]> {
    const records: ActionRecord[] = [];

    for (const { execution, runner } of actions) {
      if (!runner) {
        // Should not happen since we wait for ready, but just in case
        this.#warn(
          `No runner available for instance "${instanceId}" action "${execution.action}", skipping`,
        );
        records.push({
          instanceId,
          action: execution.action,
          result: ok(undefined),
          duration: 0,
          skipped: true,
          errorCategory: 'readiness',
        });
        continue;
      }

      // Look up the specific handler for this action
      const handler = runner[execution.action];
      if (!handler) {
        this.#warn(
          `No handler for action "${execution.action}" on instance "${instanceId}", skipping`,
        );
        records.push({
          instanceId,
          action: execution.action,
          result: ok(undefined),
          duration: 0,
          skipped: true,
          errorCategory: 'application',
        });
        continue;
      }

      records.push(
        await this.#runHandler(instanceId, execution, handler, observe),
      );
    }

    return records;
  }

  async #executeInstanceActionsWithTransitions(
    instanceId: InstanceId,
    executions: readonly ActionExecution[],
    transitions: VariantTransitions,
    observe?: (progress: ActionProgress) => void,
  ): Promise<ActionRecord[]> {
    const records: ActionRecord[] = [];

    for (const execution of executions) {
      // React registers runners in an effect keyed by Instance, so a Vessel
      // that renders a different component per Variant swaps its runner after
      // a transition. Reading it per Action picks up the replacement.
      const runner = await this.#currentRunner(instanceId);
      if (!runner) {
        const reason = `No runner registered for Instance "${instanceId}" when Action "${execution.action}" was due`;
        this.#warn(`${reason}, skipping`);
        records.push(
          skippedRecord(instanceId, execution.action, 'readiness', reason),
        );
        continue;
      }

      const resolution = transitions.resolve(instanceId, execution.action);
      if (resolution.status !== 'available') {
        const reason = describeUnavailableAction(
          instanceId,
          execution.action,
          resolution,
        );
        this.#warn(`${reason}, skipping`);
        records.push(
          skippedRecord(instanceId, execution.action, 'application', reason),
        );
        continue;
      }

      const target = this.#transitionTarget(
        instanceId,
        execution.action,
        resolution,
      );
      const handler = runner[execution.action];

      if (!handler) {
        if (resolution.transition.kind === 'none') {
          const reason = `Action "${execution.action}" has no handler on Instance "${instanceId}" and no transition on Variant "${resolution.variant}"`;
          this.#warn(`${reason}, skipping`);
          records.push(
            skippedRecord(instanceId, execution.action, 'application', reason),
          );
          continue;
        }
        if (resolution.transition.kind === 'unknown_target') {
          const reason = `Action "${execution.action}" has no handler on Instance "${instanceId}" and transitions to unknown Variant "${resolution.transition.target}"`;
          records.push(
            skippedRecord(instanceId, execution.action, 'application', reason),
          );
          continue;
        }
        if (target) {
          this.#applyTransition(
            transitions,
            instanceId,
            execution.action,
            resolution.variant,
            target,
          );
        }
        records.push({
          instanceId,
          action: execution.action,
          result: ok(undefined),
          duration: 0,
        });
        continue;
      }

      const record = await this.#runHandler(
        instanceId,
        execution,
        handler,
        observe,
      );
      records.push(record);
      if (record.result.ok && target) {
        this.#applyTransition(
          transitions,
          instanceId,
          execution.action,
          resolution.variant,
          target,
        );
      }
    }

    return records;
  }

  async #currentRunner(
    instanceId: InstanceId,
  ): Promise<AnyActionRunner | undefined> {
    const runner = this.#getRunnerForInstance(instanceId);
    if (runner) return runner;
    const ready = await this.waitForReady(instanceId, this.#readinessTimeoutMs);
    return ready ? this.#getRunnerForInstance(instanceId) : undefined;
  }

  // Resolves to the Variant a successful run moves the Instance to, or
  // undefined when the Action leaves the Variant alone.
  #transitionTarget(
    instanceId: InstanceId,
    action: ActionName,
    resolution: Extract<ActionVariantResolution, { status: 'available' }>,
  ): VariantName | undefined {
    const { transition, variant } = resolution;
    if (transition.kind === 'unknown_target') {
      this.#warn(
        `Action "${action}" on Instance "${instanceId}" transitions to unknown Variant "${transition.target}"; applying no transition`,
      );
      return undefined;
    }
    if (transition.kind === 'none' || transition.variant === variant) {
      return undefined;
    }
    return transition.variant;
  }

  #applyTransition(
    transitions: VariantTransitions,
    instanceId: InstanceId,
    action: ActionName,
    from: VariantName,
    to: VariantName,
  ): void {
    if (transitions.apply(instanceId, from, to)) {
      this.#logger.debug(
        `Action "${action}" moved Instance "${instanceId}" from Variant "${from}" to "${to}"`,
      );
      return;
    }
    this.#logger.debug(
      `Action "${action}" did not move Instance "${instanceId}" to Variant "${to}": it is no longer in "${from}"`,
    );
  }

  async #runHandler(
    instanceId: InstanceId,
    execution: ActionExecution,
    handler: AnyActionRunner[string],
    observe?: (progress: ActionProgress) => void,
  ): Promise<ActionRecord> {
    const startTime = performance.now();
    let timedOut = false;
    try {
      this.#logger.debug(
        `Executing action "${execution.action}" on instance "${instanceId}"`,
      );

      observe?.({ instanceId, action: execution.action, phase: 'started' });
      const handlerResult = handler(execution.params);

      // Handle both sync (Result) and async (Promise<Result>) handlers
      // without unnecessary Promise wrapping overhead for sync handlers
      const result = isPromise(handlerResult)
        ? await this.#withExecutionTimeout(
            handlerResult,
            instanceId,
            execution.action,
            () => {
              timedOut = true;
            },
          )
        : handlerResult;

      const duration = performance.now() - startTime;

      this.#logger.debug(
        `Action "${execution.action}" completed on instance "${instanceId}" (${duration.toFixed(2)}ms)`,
      );

      return {
        instanceId,
        action: execution.action,
        result,
        duration,
        ...(result.ok ? {} : { errorCategory: 'application' as const }),
      };
    } catch (error) {
      const duration = performance.now() - startTime;

      this.#logger.error(
        `Action "${execution.action}" failed on instance "${instanceId}":`,
        error instanceof Error ? error.message : String(error),
      );

      return {
        instanceId,
        action: execution.action,
        result: err(toError(error)),
        duration,
        errorCategory: timedOut ? 'timeout' : 'application',
      };
    }
  }

  #warn(message: string): void {
    if (this.#disposed) return;
    this.#logger.warn(message);
  }

  /**
   * Race an async handler result against the configured execution timeout.
   * Throws if the handler does not resolve within the timeout.
   */
  async #withExecutionTimeout<T>(
    promise: Promise<T>,
    instanceId: InstanceId,
    action: ActionName,
    onTimeout: () => void,
  ): Promise<T> {
    if (this.#executionTimeoutMs <= 0) return promise;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        onTimeout();
        reject(
          new Error(
            `Action "${action}" on instance "${instanceId}" timed out after ${this.#executionTimeoutMs}ms`,
          ),
        );
      }, this.#executionTimeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function skippedRecord(
  instanceId: InstanceId,
  action: ActionName,
  errorCategory: 'readiness' | 'application',
  reason: string,
): ActionRecord {
  return {
    instanceId,
    action,
    result: ok(undefined),
    duration: 0,
    skipped: true,
    errorCategory,
    reason,
  };
}

function describeUnavailableAction(
  instanceId: InstanceId,
  action: ActionName,
  resolution: Exclude<ActionVariantResolution, { status: 'available' }>,
): string {
  switch (resolution.status) {
    case 'instance_missing':
      return `Action "${action}" targets Instance "${instanceId}", which is not in the store`;
    case 'vessel_unknown':
      return `Action "${action}" cannot be resolved on Variant "${resolution.variant}" of Instance "${instanceId}": Vessel "${resolution.vesselId}" is not registered`;
    case 'action_not_on_variant':
      return `Action "${action}" is not defined on Variant "${resolution.variant}" of Instance "${instanceId}"`;
  }
}
