import type {
  ChartRequest,
  MaelstromEvent,
  MaelstromResponse,
  ActionCompletedEvent,
  ActionStartedEvent,
  LayoutAppliedEvent,
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

  function dispatch(action: StateAction): void {
    state = stateReducer(state, action);
    for (const listener of stateListeners) {
      listener(state);
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
    connector.disconnect?.();
    dispatch({ type: 'SET_CONNECTION_STATE', state: 'disconnected' });
  }

  async function processIntent(intent: string): Promise<MaelstromResponse> {
    if (state.isProcessing) {
      if (resolvedConfig.debug) {
        console.log('[Maelstrom] Already processing, skipping');
      }
      throw new Error('Already processing a request');
    }

    dispatch({ type: 'SET_PROCESSING', isProcessing: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      // Build request
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
          userIntent: intent,
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

      const layoutEvent: LayoutAppliedEvent = {
        type: 'layout_applied',
        directives: response.layoutDirective,
        timestamp: Date.now(),
      };
      emitEvent(layoutEvent);

      return response;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: 'SET_ERROR', error: error.message });
      if (resolvedConfig.debug) {
        console.error('[Maelstrom] Error:', err);
      }
      throw error;
    } finally {
      dispatch({ type: 'SET_PROCESSING', isProcessing: false });
    }
  }

  return {
    getState: () => state,
    dispatch,
    subscribe: (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    processIntent,
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
