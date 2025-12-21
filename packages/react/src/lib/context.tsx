import type {
  ActionCompletedEvent,
  ActionStartedEvent,
  ChartRequest,
  LayoutAppliedEvent,
  MaelstromEvent,
  Vessel,
} from '@maelstrom/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import type {
  EngineConnector,
  MaelstromAction,
  MaelstromProviderProps,
  MaelstromState,
} from './types';

// ============================================================================
// Initial State
// ============================================================================

const initialState: MaelstromState = {
  vessels: new Map(),
  instances: new Map(),
  layout: [],
  chartDimensions: { columns: 12, rows: 8 },
  connectionState: 'disconnected',
  isProcessing: false,
  lastError: null,
  lastResponse: null,
};

// ============================================================================
// Reducer
// ============================================================================

function reducer(
  state: MaelstromState,
  action: MaelstromAction,
): MaelstromState {
  switch (action.type) {
    case 'REGISTER_VESSEL': {
      const newVessels = new Map(state.vessels);
      newVessels.set(action.registration.vessel.id, action.registration);
      return { ...state, vessels: newVessels };
    }
    case 'UNREGISTER_VESSEL': {
      const newVessels = new Map(state.vessels);
      newVessels.delete(action.vesselId);
      return { ...state, vessels: newVessels };
    }
    case 'ADD_INSTANCE': {
      const newInstances = new Map(state.instances);
      newInstances.set(action.instance.instanceId, action.instance);
      // Also add to layout so new instances are visible by default
      const newLayout = [
        ...state.layout,
        {
          instanceId: action.instance.instanceId,
          position: action.instance.position,
          size: action.instance.size,
        },
      ];
      return { ...state, instances: newInstances, layout: newLayout };
    }
    case 'UPDATE_INSTANCE': {
      const existing = state.instances.get(action.instanceId);
      if (!existing) return state;
      const newInstances = new Map(state.instances);
      newInstances.set(action.instanceId, { ...existing, ...action.updates });
      return { ...state, instances: newInstances };
    }
    case 'REMOVE_INSTANCE': {
      const newInstances = new Map(state.instances);
      newInstances.delete(action.instanceId);
      // Also remove from layout
      const newLayout = state.layout.filter(
        (d) => d.instanceId !== action.instanceId,
      );
      return { ...state, instances: newInstances, layout: newLayout };
    }
    case 'SET_CHART_DIMENSIONS':
      return { ...state, chartDimensions: action.dimensions };
    case 'SET_CONNECTION_STATE':
      return { ...state, connectionState: action.state };
    case 'SET_PROCESSING':
      return { ...state, isProcessing: action.isProcessing };
    case 'SET_ERROR':
      return { ...state, lastError: action.error };
    case 'APPLY_LAYOUT': {
      // Store layout as source of truth for rendering
      // Also update instance positions for consistency
      const newInstances = new Map(state.instances);
      for (const directive of action.directives) {
        const existing = newInstances.get(directive.instanceId);
        if (existing) {
          newInstances.set(directive.instanceId, {
            ...existing,
            position: directive.position,
            size: directive.size,
          });
        }
      }
      return { ...state, instances: newInstances, layout: action.directives };
    }
    case 'EXECUTE_ACTION': {
      const existing = state.instances.get(action.execution.instanceId);
      if (!existing) return state;

      // Find the vessel definition
      const vesselReg = state.vessels.get(existing.vesselId);
      if (!vesselReg) return state;

      // Find the current variant's actions
      const currentVariant = vesselReg.vessel.variants[existing.variant];
      if (!currentVariant) return state;

      // Find the action
      const actionDef = currentVariant.actions.find(
        (a) => a.name === action.execution.action,
      );
      if (!actionDef) return state;

      // Transition to new variant if specified
      if (actionDef.transitionsTo) {
        const newInstances = new Map(state.instances);
        newInstances.set(existing.instanceId, {
          ...existing,
          variant: actionDef.transitionsTo,
        });
        return { ...state, instances: newInstances };
      }

      return state;
    }
    case 'SET_LAST_RESPONSE':
      return { ...state, lastResponse: action.response };
    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

interface MaelstromContextValue {
  state: MaelstromState;
  dispatch: React.Dispatch<MaelstromAction>;
  connector: EngineConnector;
  sessionId: string;
  cellSizePx: number;
  debug: boolean;
  emitEvent: (event: MaelstromEvent) => void;
  processIntent: (intent: string) => Promise<void>;
}

const MaelstromContext = createContext<MaelstromContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

let sessionCounter = 0;
function generateSessionId(): string {
  return `session-${Date.now()}-${++sessionCounter}`;
}

export function MaelstromProvider({
  connector,
  sessionId: providedSessionId,
  cellSizePx = 80,
  debug = false,
  onEvent,
  onResponse,
  onError,
  children,
}: MaelstromProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const sessionId = useRef(providedSessionId || generateSessionId()).current;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Emit events
  const emitEvent = useCallback(
    (event: MaelstromEvent) => {
      if (debug) {
        console.log('[Maelstrom Event]', event);
      }
      onEventRef.current?.(event);
    },
    [debug],
  );

  // Connect to engine on mount
  useEffect(() => {
    if (connector.connect) {
      dispatch({ type: 'SET_CONNECTION_STATE', state: 'connecting' });
      connector
        .connect()
        .then(() =>
          dispatch({ type: 'SET_CONNECTION_STATE', state: 'connected' }),
        )
        .catch(() =>
          dispatch({ type: 'SET_CONNECTION_STATE', state: 'error' }),
        );
    } else {
      // No connection needed (e.g., direct function calls)
      dispatch({ type: 'SET_CONNECTION_STATE', state: 'connected' });
    }

    // Subscribe to connection state changes
    const unsubscribe = connector.onConnectionStateChange?.((connectionState) =>
      dispatch({ type: 'SET_CONNECTION_STATE', state: connectionState }),
    );

    return () => {
      unsubscribe?.();
      connector.disconnect?.();
    };
  }, [connector]);

  // Process user intent
  const processIntent = useCallback(
    async (intent: string) => {
      if (state.isProcessing) {
        if (debug) console.log('[Maelstrom] Already processing, skipping');
        return;
      }

      dispatch({ type: 'SET_PROCESSING', isProcessing: true });
      dispatch({ type: 'SET_ERROR', error: null });

      try {
        // Build request
        const vessels: Vessel[] = Array.from(state.vessels.values()).map(
          (r) => r.vessel,
        );
        const instances = Array.from(state.instances.values()).map((i) => ({
          instanceId: i.instanceId,
          vesselId: i.vesselId,
          variant: i.variant,
          position: i.position,
          size: i.size,
        }));

        const request: ChartRequest = {
          type: 'chart_request',
          id: `req-${Date.now()}`,
          context: {
            userIntent: intent,
            chartDimensions: state.chartDimensions,
            timestamp: Date.now(),
            sessionId,
          },
          instances,
          vessels,
          currentLayout: state.layout,
        };

        if (debug) {
          console.log('[Maelstrom] Sending request:', request);
        }

        // Send to engine
        const response = await connector.process(request);

        if (debug) {
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
            dispatch({ type: 'EXECUTE_ACTION', execution });

            // Find the new variant
            const vesselReg = state.vessels.get(instance.vesselId);
            const actionDef = vesselReg?.vessel.variants[
              instance.variant
            ]?.actions.find((a) => a.name === execution.action);
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

        // Call onResponse callback so consumer can handle userMessage
        onResponseRef.current?.(response);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        dispatch({ type: 'SET_ERROR', error: error.message });
        if (debug) {
          console.error('[Maelstrom] Error:', err);
        }
        // Call onError callback
        onErrorRef.current?.(error);
      } finally {
        dispatch({ type: 'SET_PROCESSING', isProcessing: false });
      }
    },
    [state, connector, sessionId, debug, emitEvent],
  );

  const value: MaelstromContextValue = {
    state,
    dispatch,
    connector,
    sessionId,
    cellSizePx,
    debug,
    emitEvent,
    processIntent,
  };

  return (
    <MaelstromContext.Provider value={value}>
      {children}
    </MaelstromContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useMaelstromContext(): MaelstromContextValue {
  const context = useContext(MaelstromContext);
  if (!context) {
    throw new Error(
      'useMaelstromContext must be used within a MaelstromProvider',
    );
  }
  return context;
}
