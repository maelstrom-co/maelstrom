import {
  MessageId,
  type ChartResizeReason,
  type MaelstromResponse,
  type UpdateReason,
  type VesselMutationReason,
} from '@maelstrom-co/protocol';

import { ChartManager } from '../chart-manager/chart-manager.js';
import { ConnectionManager } from '../connection-manager/connection-manager.js';
import type {
  AssistantMessage,
  EngineConnector,
  PushConnector,
} from '../connection-manager/connector.types.js';
import { CommandProcessor } from '../command-processor/command-processor.js';
import { UpdateCoordinator } from '../update-coordination/update-coordinator.js';
import { Logger } from '../utils/logger.js';
import { VesselManager } from '../vessel-management/vessel-manager.js';
import { buildChartRequest } from './build-chart-request.js';
import type {
  OrchestratorOptions,
  OrchestratorViewState,
  ResolvedOrchestratorOptions,
} from './orchestrator.types.js';
import { resolveOrchestratorOptions } from './orchestrator.types.js';
import { RequestCoordinator } from './request-coordinator.js';

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

  // ==========================================================================
  // Request lifecycle (sequencing only — no state)
  // ==========================================================================

  async processIntent(intent: string): Promise<MaelstromResponse> {
    if (this.#isDisposed) {
      throw new Error('Orchestrator is disposed');
    }
    if (this.#requestCoordinator.isProcessing) {
      throw new Error('A request is already in flight');
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
    const assistantMessage: AssistantMessage = {
      id: MessageId(),
      message,
    };
    await this.#connector.addAssistantMessage(assistantMessage);
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
        try {
          const request = this.#newRequest(event.updates);
          const response = await this.#requestCoordinator.send(request);
          this.#dispatchResponse(response);
          this.#requestCoordinator.resolveFlushPromises(response);
        } catch (err) {
          this.#logger.info(
            `Timer-triggered flush failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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

  #dispatchResponse(response: MaelstromResponse): void {
    this.#commandProcessor.dispatch(
      { kind: 'set_layout', layout: response.layout },
      { kind: 'execute_actions', executionPlan: response.executionPlan },
    );
  }

  #newRequest(updates: UpdateReason[]) {
    return buildChartRequest({
      requestId: MessageId(`req-${Date.now()}-${++this.#requestCounter}`),
      updates,
      instances: this.#commandProcessor.store.state.instances,
      chartDimensions: this.#chartManager.store.state.chartDimensions,
      layout: this.#commandProcessor.store.state.layout,
      vessels: this.#vesselManager.getAll(),
      config: this.#config,
    });
  }
}
