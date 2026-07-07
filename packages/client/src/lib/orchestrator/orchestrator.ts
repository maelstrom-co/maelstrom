import {
  ChartRequestMessage,
  MessageId,
  type ActionExecution,
  type ActionName,
  type ChartResizeReason,
  type InstanceId,
  type MaelstromResponse,
  type SessionHistoryEntry,
  type SessionId,
  type UpdateReason,
  type VariantName,
  type VesselMutationReason,
  toError,
} from '@maelstrom-co/protocol';

import { ChartManager } from '../chart-manager/chart-manager.js';
import { ConnectionManager } from '../connection-manager/connection-manager.js';
import type {
  AssistantMessage,
  EngineConnector,
  PushConnector,
} from '../connection-manager/connector.types.js';
import { CommandProcessor } from '../command-processor/command-processor.js';
import type { Unsubscribe } from '../types.js';
import { UpdateCoordinator } from '../update-coordination/update-coordinator.js';
import { Logger } from '../utils/logger.js';
import { VesselManager } from '../vessel-management/vessel-manager.js';
import {
  readCapabilitySnapshot,
  type CapabilitySnapshot,
} from '../voice-session/capability-snapshot.js';
import {
  readStructuralSnapshot,
  type UIStructuralSnapshot,
} from '../voice-session/ui-structural-snapshot.js';
import { buildChartRequest } from './build-chart-request.js';
import type {
  OrchestratorOptions,
  OrchestratorViewState,
  ResolvedOrchestratorOptions,
} from './orchestrator.types.js';
import { resolveOrchestratorOptions } from './orchestrator.types.js';
import { RequestCoordinator } from './request-coordinator.js';
import { RequestInFlightError } from './request-in-flight-error.js';

/**
 * Composition root that creates, wires, and coordinates all microkernels.
 *
 * The Orchestrator owns **zero private state** and emits **zero events**.
 * It sequences calls across microkernels in the right order.
 * Consumers interact with microkernels directly for domain operations.
 *
 * @example
 * ```ts
 * const connector = new WebSocketConnector({ url: 'wss://api.example.com/ws' });
 * const orchestrator = new Orchestrator(connector, { debug: true });
 *
 * await orchestrator.connect();
 * const response = await orchestrator.processIntent('show me sales data');
 *
 * // Listen for events via microkernels directly:
 * orchestrator.requestCoordinator.events.on('processing_completed', (e) => { ... });
 * orchestrator.chartManager.setDimensions({ columns: 10, rows: 6 });
 * ```
 */
export class Orchestrator {
  readonly #connector: EngineConnector;
  readonly #config: ResolvedOrchestratorOptions;
  readonly #logger: Logger;

  // Composed microkernels
  readonly #connectionManager: ConnectionManager;
  readonly #commandProcessor: CommandProcessor;
  readonly #updateCoordinator: UpdateCoordinator;
  readonly #vesselManager: VesselManager;
  readonly #chartManager: ChartManager;
  readonly #requestCoordinator: RequestCoordinator;

  #isDisposed = false;
  #unsubscribers: (() => void)[] = [];
  #requestCounter = 0;

  constructor(connector: EngineConnector, options: OrchestratorOptions = {}) {
    this.#connector = connector;
    this.#config = resolveOrchestratorOptions(options);
    this.#logger = new Logger(this.#config.debug, 'Orchestrator');

    // Create microkernels
    this.#connectionManager = new ConnectionManager(connector, {
      debug: this.#config.debug,
      sessionId: this.#config.sessionId,
      ...this.#config.connection,
    });
    this.#commandProcessor = new CommandProcessor({
      debug: this.#config.debug,
      defaultActionWaitTimeoutMs: this.#config.readyTimeoutMs,
    });
    this.#updateCoordinator = new UpdateCoordinator({
      debounceDelayMs: this.#config.debounceDelayMs,
      maxWaitMs: this.#config.maxWaitMs,
      debug: this.#config.debug,
    });
    this.#vesselManager = new VesselManager({
      debug: this.#config.debug,
    });
    this.#chartManager = new ChartManager({
      debug: this.#config.debug,
    });
    this.#requestCoordinator = new RequestCoordinator(connector, {
      debug: this.#config.debug,
    });

    this.#setupSubscriptions();
  }

  // ==========================================================================
  // Microkernel accessors
  // ==========================================================================

  get connectionManager(): ConnectionManager {
    return this.#connectionManager;
  }

  get commandProcessor(): CommandProcessor {
    return this.#commandProcessor;
  }

  get vesselManager(): VesselManager {
    return this.#vesselManager;
  }

  get chartManager(): ChartManager {
    return this.#chartManager;
  }

  get requestCoordinator(): RequestCoordinator {
    return this.#requestCoordinator;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  getConfig(): ResolvedOrchestratorOptions {
    return this.#config;
  }

  getViewState(): OrchestratorViewState {
    return {
      isProcessing: this.#requestCoordinator.isProcessing,
      isConnected:
        this.#connectionManager.store.state.connectionStatus === 'connected',
      sessionId: this.#config.sessionId,
      layoutMode: this.#config.layoutMode,
    };
  }

  /** Structural-only UI snapshot for grounding + `get_ui_state` pulls. */
  getStructuralSnapshot(): UIStructuralSnapshot {
    return readStructuralSnapshot(this);
  }

  /** Capability catalog (vessels, variants, actions) for `get_capabilities` pulls. */
  getCapabilitySnapshot(): CapabilitySnapshot {
    return readCapabilitySnapshot(this.#vesselManager.getAll());
  }

  /**
   * Subscribe to the render-settled signal.
   *
   * Fires whenever the CommandProcessor's command queue drains back to
   * idle — the moment a batch of layout + action commands has fully
   * applied. Both settle sources required by grounding reach this
   * transition: an engine response dispatched via `processIntent` /
   * `flushUpdates` (`set_layout` + `execute_actions` as one atomic batch),
   * and direct manipulation (a user click / variant change, which reaches
   * the processor through `commandProcessor.executeActions()` the same way
   * a React `executeAction` call does). Neither path bypasses the queue, so
   * a single subscription to the queue-idle transition grounds both.
   *
   * This is the grounding-push trigger only — it is NOT how speak-after-render
   * is sequenced. That flow awaits a specific intent's own
   * `commandProcessor.waitForIdle()` after `processIntent` resolves, so it
   * correlates to that intent's response rather than racing this global signal.
   *
   * May fire more than once per logical settle (each queue-drain-to-idle
   * transition invokes it); downstream consumers that only want the latest
   * state should debounce.
   */
  onSettled(cb: () => void): Unsubscribe {
    const isIdle = () =>
      this.#commandProcessor.store.state.status === 'idle' &&
      this.#commandProcessor.queueLength === 0;

    let wasIdle = isIdle();
    const subscription = this.#commandProcessor.store.subscribe(() => {
      const idleNow = isIdle();
      if (idleNow && !wasIdle) {
        cb();
      }
      wasIdle = idleNow;
    });

    return () => subscription.unsubscribe();
  }

  // ==========================================================================
  // Request lifecycle (sequencing only — no state)
  // ==========================================================================

  async processIntent(intent: string): Promise<MaelstromResponse> {
    if (this.#isDisposed) {
      throw new Error('Orchestrator is disposed');
    }
    if (this.#requestCoordinator.isProcessing) {
      throw new RequestInFlightError();
    }

    const pendingUpdates = this.#updateCoordinator.takeCoalesced();
    const updates: UpdateReason[] = [
      ...pendingUpdates,
      { type: 'user_intent', intent },
    ];

    this.#logger.info(
      `Processing intent with ${updates.length} batched updates`,
    );

    const request = this.#newRequest(updates);
    const response = await this.#requestCoordinator.send(request);
    this.#dispatchResponse(response);
    this.#requestCoordinator.resolveFlushPromises(response);
    return response;
  }

  scheduleUpdate(reason: ChartResizeReason | VesselMutationReason): void {
    this.#updateCoordinator.schedule(reason);
  }

  async flushUpdates(): Promise<MaelstromResponse | null> {
    if (this.#isDisposed) return null;

    const updates = this.#updateCoordinator.takeCoalesced();
    if (updates.length === 0) {
      return null;
    }

    if (this.#requestCoordinator.isProcessing) {
      this.#logger.info('Already processing, queueing flush promise');
      for (const update of updates) this.#updateCoordinator.schedule(update);
      return this.#requestCoordinator.queueFlush();
    }

    const request = this.#newRequest(updates);
    const response = await this.#requestCoordinator.send(request);
    this.#dispatchResponse(response);
    this.#requestCoordinator.resolveFlushPromises(response);
    return response;
  }

  // ==========================================================================
  // Local action invocation
  // ==========================================================================

  /**
   * Invoke a vessel action locally — the client-authoritative path for actions
   * a user triggers directly in the UI (e.g. a button click), as opposed to
   * actions the engine returns in an execution plan.
   *
   * WHAT it does, in order:
   * 1. Validates that `instanceId` exists and that `action` is declared on the
   *    instance's **current** variant. If either check fails it logs a warning
   *    and no-ops — it never throws, so it is safe to call straight from a
   *    render callback.
   * 2. If the action declares a `transitionsTo` variant that exists on the
   *    vessel, it updates the store's variant **synchronously, before the
   *    runner runs** — the store is authoritative and the UI reflects the new
   *    variant immediately (no optimistic-override-then-rollback dance).
   * 3. Runs the action's registered runner through the same CommandProcessor /
   *    ActionManager machinery as engine-plan actions (runner-readiness wait,
   *    execution timeout, `action_error` emission).
   * 4. If the runner fails (error result, throw, or timeout), reverts the
   *    variant — but only if the store variant is still the one this call set,
   *    so a newer transition or an engine layout that landed in between wins.
   * 5. When (and only when) a transition actually happened in step 2, schedules
   *    a `vessel_mutation` update so the engine can re-plan layout. Bursts are
   *    coalesced by the UpdateCoordinator's debounce.
   *
   * WHY: vessels declare their own state machines, so a locally-invoked action
   * with a `transitionsTo` is a fact the client already knows — applying it
   * locally makes the client the authority instead of waiting on an engine
   * round-trip.
   *
   * INVARIANTS:
   * - Never throws; invalid input warns and no-ops.
   * - The variant transition is applied before the runner is awaited.
   * - A revert never clobbers a variant a later write already changed.
   * - No transition (parameterless / no `transitionsTo`) → no engine update.
   *
   * @param instanceId - The instance to act on; must exist in the store.
   * @param action - The action name; must be declared on the current variant.
   * @param params - Optional parameter object passed to the runner verbatim.
   *
   * @example
   * ```ts
   * // In a vessel's render callback:
   * <button onClick={() => orchestrator.invokeAction(instanceId, 'expand')}>
   *   Expand
   * </button>
   * ```
   */
  invokeAction(
    instanceId: InstanceId,
    action: ActionName,
    params?: Record<string, unknown>,
  ): void {
    if (this.#isDisposed) {
      this.#logger.warn('invokeAction called after dispose; ignoring');
      return;
    }

    const instance = this.#commandProcessor.store.state.instances.get(
      instanceId,
    );
    if (!instance) {
      this.#logger.warn(`invokeAction: unknown instance "${instanceId}"`);
      return;
    }

    const vessel = this.#vesselManager.get(instance.vesselId);
    if (!vessel) {
      this.#logger.warn(
        `invokeAction: no vessel definition for "${instance.vesselId}"`,
      );
      return;
    }

    const currentVariant = instance.variant;
    const actionDef = vessel.variants[currentVariant]?.actions.find(
      (a) => a.name === action,
    );
    if (!actionDef) {
      this.#logger.warn(
        `invokeAction: action "${action}" is not available on variant "${currentVariant}" of instance "${instanceId}"`,
      );
      return;
    }

    // Transition first: apply the declared variant change locally so the UI
    // updates before the (async) runner runs.
    let transition: { from: VariantName; to: VariantName } | null = null;
    const target = actionDef.transitionsTo;
    if (target !== undefined) {
      if (!Object.hasOwn(vessel.variants, target)) {
        this.#logger.warn(
          `invokeAction: action "${action}" transitionsTo unknown variant "${target}"; running without transition`,
        );
      } else if (
        this.#commandProcessor.setVariantIfCurrent(
          instanceId,
          currentVariant,
          target,
        )
      ) {
        transition = { from: currentVariant, to: target };
        this.scheduleUpdate({
          type: 'vessel_mutation',
          instanceId,
          changes: `user invoked "${action}": variant ${currentVariant} → ${target}`,
        });
      }
    }

    const execution: ActionExecution = { instanceId, action, params };
    void this.#runLocalAction(execution, transition);
  }

  // ==========================================================================
  // Connection lifecycle
  // ==========================================================================

  async connect(): Promise<void> {
    await this.#connectionManager.connect();
  }

  async disconnect(): Promise<void> {
    this.#updateCoordinator.clear();
    await this.#connectionManager.disconnect();
  }

  // ==========================================================================
  // Cross-cutting (needs config + connector)
  // ==========================================================================

  async addAssistantMessage(message: string): Promise<void> {
    this.#logger.info('Injecting assistant message');
    const assistantMessage: AssistantMessage = {
      id: MessageId(),
      message,
    };
    await this.#connector.addAssistantMessage(assistantMessage);
  }

  /**
   * Fetch the engine-recorded history for the given session.
   *
   * Use this to rehydrate a conversation after a refresh, on a new device,
   * or in a parallel tab — anywhere a developer has persisted a session id
   * and wants to seed UI state from the server. The session id is passed
   * explicitly (rather than read from the orchestrator's own
   * `config.sessionId`) so callers can fetch any session they have an id
   * for, including a session that predates this orchestrator instance.
   *
   * Errors from the connector (transport failure, engine error) propagate
   * as thrown `Error`s — same shape as `addAssistantMessage` and
   * `processIntent`.
   */
  async getHistory(
    sessionId: SessionId,
  ): Promise<readonly SessionHistoryEntry[]> {
    if (this.#isDisposed) {
      throw new Error('Orchestrator is disposed');
    }
    return this.#connector.getHistory(sessionId);
  }

  // ==========================================================================
  // Disposal
  // ==========================================================================

  async dispose(): Promise<void> {
    if (this.#isDisposed) return;

    this.#isDisposed = true;
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers = [];

    await this.#connectionManager.dispose();
    this.#chartManager.dispose();
    this.#vesselManager.dispose();
    this.#updateCoordinator.dispose();
    this.#commandProcessor.dispose();
    this.#requestCoordinator.dispose();
  }

  // ==========================================================================
  // Private methods
  // ==========================================================================

  #setupSubscriptions(): void {
    // Wire chart dimension changes → schedule resize updates
    const unsubDimensions = this.#chartManager.events.on(
      'dimensions_changed',
      (event) => {
        if (
          this.#connectionManager.store.state.connectionStatus === 'connected'
        ) {
          this.scheduleUpdate(event.resize);
        }
      },
    );
    this.#unsubscribers.push(unsubDimensions);

    // Wire connection status → flush pending resize on connect
    const unsubConnection = this.#connectionManager.events.on(
      'connection_status_changed',
      (event) => {
        if (event.status === 'connected') {
          const pendingResize = this.#chartManager.getPendingResize();
          if (pendingResize) {
            this.scheduleUpdate(pendingResize);
            this.#chartManager.clearPendingResize();
          }
        }
      },
    );
    this.#unsubscribers.push(unsubConnection);

    // Wire UpdateCoordinator timer-triggered flushes
    const unsubFlush = this.#updateCoordinator.events.on(
      'updates_flushed',
      async (event) => {
        if (this.#isDisposed) return;

        if (this.#requestCoordinator.isProcessing) {
          // A request is already in flight; its completion will
          // handle any queued flush promises.
          return;
        }

        let request: ChartRequestMessage;
        try {
          request = this.#newRequest(event.updates);
        } catch (err) {
          // Synchronous construction failure (e.g., ChartRequestMessage's
          // resolveTimestamp guard). RequestCoordinator never saw it, so we
          // need to log here AND settle queued flush promises.
          const error = toError(err);
          this.#logger.error(
            `Timer-flush request construction failed: ${error.message}`,
          );
          this.#requestCoordinator.rejectFlushPromises(error);
          return;
        }

        let response: MaelstromResponse;
        try {
          response = await this.#requestCoordinator.send(request);
        } catch (err) {
          // send() already surfaces the error via the 'error' event.
          // Settle queued flush promises so consumers don't time out.
          const error = toError(err);
          this.#requestCoordinator.rejectFlushPromises(error);
          return;
        }

        try {
          this.#dispatchResponse(response);
        } catch (err) {
          // dispatchResponse delegates to CommandProcessor; failures here are
          // not surfaced upstream, so we log and reject queued flushes.
          const error = toError(err);
          this.#logger.error(`Timer-flush dispatch failed: ${error.message}`);
          this.#requestCoordinator.rejectFlushPromises(error);
          return;
        }
        this.#requestCoordinator.resolveFlushPromises(response);
      },
    );
    this.#unsubscribers.push(unsubFlush);

    // Wire push connector if supported
    if ('onPushMessage' in this.#connector) {
      const unsubPush = (this.#connector as PushConnector).onPushMessage(
        (response: MaelstromResponse) => {
          this.#logger.info('Received push message, processing');
          this.#dispatchResponse(response);
        },
      );
      this.#unsubscribers.push(unsubPush);
    }
  }

  async #runLocalAction(
    execution: ActionExecution,
    transition: { from: VariantName; to: VariantName } | null,
  ): Promise<void> {
    const outcome = await this.#commandProcessor.runLocalAction(execution);
    if (outcome === 'failed' && transition) {
      // Guarded revert: only undo when our transition still stands.
      this.#commandProcessor.setVariantIfCurrent(
        execution.instanceId,
        transition.to,
        transition.from,
      );
    }
  }

  #dispatchResponse(response: MaelstromResponse): void {
    this.#commandProcessor.dispatch(
      { kind: 'set_layout', layout: response.layout },
      { kind: 'execute_actions', executionPlan: response.executionPlan },
    );
  }

  #newRequest(updates: UpdateReason[]): ChartRequestMessage {
    const messageId = this.#nextRequestId();
    const request = buildChartRequest({
      updates,
      instances: this.#commandProcessor.store.state.instances,
      chartDimensions: this.#chartManager.store.state.chartDimensions,
      layout: this.#commandProcessor.store.state.layout,
      vessels: this.#vesselManager.getAll(),
      config: { layoutMode: this.#config.layoutMode },
    });
    return ChartRequestMessage({
      sessionId: this.#config.sessionId,
      id: messageId,
      request,
    });
  }

  // The id format (`req-<epoch_ms>-<counter>`) is the contract that history
  // and the request correlator both index on. Centralizing here means a
  // single edit to change the recipe.
  #nextRequestId(): MessageId {
    return MessageId(`req-${Date.now()}-${++this.#requestCounter}`);
  }
}
