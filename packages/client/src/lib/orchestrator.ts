import type {
  ActionCompletedEvent,
  ActionStartedEvent,
  ChartRequest,
  LayoutAppliedEvent,
  MaelstromEvent,
  MaelstromResponse,
  UpdateReason,
} from '@maelstrom/protocol';
import type { VesselRegistry } from './registry.js';
import { createVesselRegistry } from './registry.js';
import type { StateAction } from './state.js';
import { createInitialState, stateReducer } from './state.js';
import type {
  ClientConfig,
  EngineConnector,
  MaelstromState,
  VesselInstance,
} from './types.js';
import { DEFAULT_CELL_SIZE_PX } from './types.js';
import type { UpdateQueue } from './update-queue.js';
import { createUpdateQueue } from './update-queue.js';

// ============================================================================
// Orchestrator Interface
// ============================================================================

export interface Orchestrator {
  /** Get current state */
  getState(): MaelstromState;

  /** Dispatch a state action */
  dispatch(action: StateAction): void;

  /** Subscribe to state changes */
  subscribe(listener: (state: MaelstromState) => void): () => void;

  /** Process a user intent through the engine */
  processIntent(intent: string): Promise<MaelstromResponse>;

  /**
   * Schedule an update to be sent to the engine.
   * Updates are batched and debounced for efficiency.
   * User intents trigger an immediate flush.
   */
  scheduleUpdate(reason: UpdateReason): void;

  /**
   * Immediately flush any pending updates to the engine.
   * Returns a promise that resolves when processing is complete.
   */
  flushUpdates(): Promise<MaelstromResponse | null>;

  /** Get the vessel registry */
  getRegistry(): VesselRegistry;

  /** Get configuration */
  getConfig(): ResolvedConfig;

  /** Connect to the engine */
  connect(): Promise<void>;

  /** Disconnect from the engine */
  disconnect(): void;

  /** Subscribe to Maelstrom events */
  onEvent(listener: (event: MaelstromEvent) => void): () => void;
}

interface ResolvedConfig {
  sessionId: string;
  cellSizePx: number;
  debug: boolean;
}

// ============================================================================
// Orchestrator Implementation
// ============================================================================

let sessionCounter = 0;
function generateSessionId(): string {
  return `session-${Date.now()}-${++sessionCounter}`;
}

export function createOrchestrator(
  connector: EngineConnector,
  config: ClientConfig = {},
): Orchestrator {
  let state = createInitialState();
  const registry = createVesselRegistry();
  const stateListeners = new Set<(state: MaelstromState) => void>();
  const eventListeners = new Set<(event: MaelstromEvent) => void>();

  const resolvedConfig: ResolvedConfig = {
    sessionId: config.sessionId || generateSessionId(),
    cellSizePx: config.cellSizePx ?? DEFAULT_CELL_SIZE_PX,
    debug: config.debug ?? false,
  };

  // ============================================================================
  // State Flags
  // ============================================================================

  /** Flag to track if we're processing an engine response (to avoid loops) */
  let isApplyingEngineResponse = false;

  /** Last response for flush resolution */
  let lastProcessedResponse: MaelstromResponse | null = null;

  /** Promise resolvers waiting for flush completion */
  let flushPromiseResolvers: {
    resolve: (value: MaelstromResponse | null) => void;
    reject: (error: Error) => void;
  }[] = [];

  // ============================================================================
  // Update Queue
  // ============================================================================

  const updateQueue: UpdateQueue = createUpdateQueue({
    debug: resolvedConfig.debug,
    onFlush: async (updates) => {
      const response = await processUpdates(updates);
      lastProcessedResponse = response;
    },
  });

  // ============================================================================
  // Core Functions
  // ============================================================================

  function dispatch(action: StateAction): void {
    const previousState = state;
    state = stateReducer(state, action);

    // Detect state changes that should trigger engine updates
    // Skip if we're applying an engine response to avoid loops
    if (!isApplyingEngineResponse) {
      detectAndQueueStateChanges(action, previousState, state);
    }

    for (const listener of stateListeners) {
      listener(state);
    }
  }

  /**
   * Detect state changes that should trigger engine updates
   */
  function detectAndQueueStateChanges(
    action: StateAction,
    previousState: MaelstromState,
    currentState: MaelstromState,
  ): void {
    switch (action.type) {
      case 'SET_CHART_DIMENSIONS': {
        // Only queue if dimensions actually changed
        const prev = previousState.chartDimensions;
        const curr = currentState.chartDimensions;
        if (prev.columns !== curr.columns || prev.rows !== curr.rows) {
          updateQueue.schedule({
            type: 'chart_resize',
            previous: prev,
            current: curr,
          });
        }
        break;
      }

      case 'UPDATE_INSTANCE': {
        // Queue a vessel mutation update
        const instance = currentState.instances.get(action.instanceId);
        if (instance) {
          const changes = Object.keys(action.updates).join(', ');
          updateQueue.schedule({
            type: 'vessel_mutation',
            instanceId: action.instanceId,
            changes: `Updated: ${changes}`,
          });
        }
        break;
      }

      case 'EXECUTE_ACTION': {
        // Queue a vessel mutation update when user manually executes an action
        // (Engine-triggered actions are wrapped in isApplyingEngineResponse and won't reach here)
        const prevInstance = previousState.instances.get(
          action.execution.instanceId,
        );
        const currInstance = currentState.instances.get(
          action.execution.instanceId,
        );
        if (
          prevInstance &&
          currInstance &&
          prevInstance.variant !== currInstance.variant
        ) {
          updateQueue.schedule({
            type: 'vessel_mutation',
            instanceId: action.execution.instanceId,
            changes: `Action "${action.execution.action}" changed variant from "${prevInstance.variant}" to "${currInstance.variant}"`,
          });
        }
        break;
      }
    }
  }

  function emitEvent(event: MaelstromEvent): void {
    if (resolvedConfig.debug) {
      console.log('[Maelstrom Event]', event);
    }
    for (const listener of eventListeners) {
      listener(event);
    }
  }

  // ============================================================================
  // Engine Processing
  // ============================================================================

  async function processUpdates(
    updates: UpdateReason[],
  ): Promise<MaelstromResponse> {
    dispatch({ type: 'SET_PROCESSING', isProcessing: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      // Build request with update reasons
      const vessels = registry.getAll();
      const instances = Array.from(state.instances.values()).map(
        (i: VesselInstance) => ({
          instanceId: i.instanceId,
          vesselId: i.vesselId,
          variant: i.variant,
        }),
      );

      const request: ChartRequest = {
        type: 'chart_request',
        id: `req-${Date.now()}`,
        context: {
          updateReasons: updates,
          chartDimensions: state.chartDimensions,
          timestamp: Date.now(),
          sessionId: resolvedConfig.sessionId,
        },
        instances,
        vessels,
        layout: state.layout,
      };

      if (resolvedConfig.debug) {
        console.log('[Maelstrom] Sending request:', request);
      }

      // Send to engine
      const response = await connector.process(request);

      if (resolvedConfig.debug) {
        console.log('[Maelstrom] Received response:', response);
      }

      // Store the last response
      dispatch({ type: 'SET_LAST_RESPONSE', response });

      // Set flag to prevent queueing updates while applying engine response
      isApplyingEngineResponse = true;

      try {
        // Execute actions in order
        for (const execution of response.executionPlan) {
          const instance = state.instances.get(execution.instanceId);
          if (!instance) continue;

          const startEvent: ActionStartedEvent = {
            type: 'action_started',
            instanceId: execution.instanceId,
            action: execution.action,
            params: execution.params,
            timestamp: Date.now(),
          };
          emitEvent(startEvent);

          const startTime = Date.now();
          const fromVariant = instance.variant;

          try {
            // Execute the action (state transition)
            dispatch({ type: 'EXECUTE_ACTION', execution, registry });

            // Find the new variant
            const vessel = registry.get(instance.vesselId);
            const actionDef = vessel?.variants[instance.variant]?.actions.find(
              (a) => a.name === execution.action,
            );
            const toVariant = actionDef?.transitionsTo || fromVariant;

            const completedEvent: ActionCompletedEvent = {
              type: 'action_completed',
              instanceId: execution.instanceId,
              action: execution.action,
              fromVariant,
              toVariant,
              success: true,
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
            emitEvent(completedEvent);
          } catch (err) {
            const completedEvent: ActionCompletedEvent = {
              type: 'action_completed',
              instanceId: execution.instanceId,
              action: execution.action,
              fromVariant,
              toVariant: fromVariant,
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
              duration: Date.now() - startTime,
              timestamp: Date.now(),
            };
            emitEvent(completedEvent);
          }
        }

        // Apply layout directives (this is the source of truth for what's rendered)
        dispatch({
          type: 'APPLY_LAYOUT',
          directives: response.layoutDirective,
        });
      } finally {
        // Reset flag after applying engine response
        isApplyingEngineResponse = false;
      }

      const layoutEvent: LayoutAppliedEvent = {
        type: 'layout_applied',
        directives: response.layoutDirective,
        timestamp: Date.now(),
      };
      emitEvent(layoutEvent);

      // Resolve any queued flush promises
      for (const { resolve } of flushPromiseResolvers) {
        resolve(response);
      }
      flushPromiseResolvers = [];

      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: 'SET_ERROR', error: error.message });
      if (resolvedConfig.debug) {
        console.error('[Maelstrom] Error:', err);
      }

      // Reject any queued flush promises
      for (const { reject } of flushPromiseResolvers) {
        reject(error);
      }
      flushPromiseResolvers = [];

      throw error;
    } finally {
      dispatch({ type: 'SET_PROCESSING', isProcessing: false });
    }
  }

  // ============================================================================
  // Public API
  // ============================================================================

  function scheduleUpdate(reason: UpdateReason): void {
    updateQueue.schedule(reason);
  }

  async function flushUpdates(): Promise<MaelstromResponse | null> {
    if (!updateQueue.hasPending()) {
      return null;
    }

    // If already processing, queue a promise
    if (state.isProcessing) {
      if (resolvedConfig.debug) {
        console.log('[Maelstrom] Already processing, queueing flush promise');
      }
      return new Promise((resolve, reject) => {
        flushPromiseResolvers.push({ resolve, reject });
      });
    }

    await updateQueue.flush();
    return lastProcessedResponse;
  }

  async function processIntent(intent: string): Promise<MaelstromResponse> {
    // Take any pending updates (coalesced) and add the user intent
    const pendingUpdates = updateQueue.takeCoalesced();
    const updates: UpdateReason[] = [
      ...pendingUpdates,
      { type: 'user_intent', intent },
    ];

    if (resolvedConfig.debug) {
      console.log(
        '[Maelstrom] Processing intent with',
        updates.length,
        'batched updates',
      );
    }

    return processUpdates(updates);
  }

  async function connect(): Promise<void> {
    if (connector.connect) {
      dispatch({ type: 'SET_CONNECTION_STATE', state: 'connecting' });
      try {
        await connector.connect();
        dispatch({ type: 'SET_CONNECTION_STATE', state: 'connected' });
      } catch {
        dispatch({ type: 'SET_CONNECTION_STATE', state: 'error' });
        throw new Error('Failed to connect to engine');
      }
    } else {
      // No connection needed (e.g., direct function calls)
      dispatch({ type: 'SET_CONNECTION_STATE', state: 'connected' });
    }

    // Subscribe to connection state changes
    connector.onConnectionStateChange?.((connectionState) =>
      dispatch({ type: 'SET_CONNECTION_STATE', state: connectionState }),
    );
  }

  function disconnect(): void {
    updateQueue.clear();
    connector.disconnect?.();
    dispatch({ type: 'SET_CONNECTION_STATE', state: 'disconnected' });
  }

  return {
    getState: () => state,
    dispatch,
    subscribe: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    processIntent,
    scheduleUpdate,
    flushUpdates,
    getRegistry: () => registry,
    getConfig: () => resolvedConfig,
    connect,
    disconnect,
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
  };
}
