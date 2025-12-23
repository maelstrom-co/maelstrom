import type { MaelstromEvent } from '@maelstrom/protocol';
import {
  createOrchestrator,
  type MaelstromState,
  type Orchestrator,
  type StateAction,
} from '@maelstrom/client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { MaelstromProviderProps, VesselComponentProps, VesselRegistration } from './types';

// ============================================================================
// Context
// ============================================================================

interface MaelstromContextValue {
  /** The underlying orchestrator instance */
  orchestrator: Orchestrator;
  /** Get current state (triggers re-render on change) */
  state: MaelstromState;
  /** Dispatch a state action */
  dispatch: (action: StateAction) => void;
  /** Component registry (React-specific) */
  componentRegistry: Map<string, React.ComponentType<VesselComponentProps>>;
  /** Register a vessel with its React component */
  registerVessel: (registration: VesselRegistration) => void;
  /** Unregister a vessel */
  unregisterVessel: (vesselId: string) => void;
  /** Process user intent */
  processIntent: (intent: string) => Promise<void>;
  /** Cell size in pixels */
  cellSizePx: number;
  /** Debug mode */
  debug: boolean;
}

const MaelstromContext = createContext<MaelstromContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function MaelstromProvider({
  connector,
  sessionId,
  cellSizePx = 80,
  debug = false,
  onEvent,
  onResponse,
  onError,
  children,
}: MaelstromProviderProps) {
  // Create orchestrator once
  const orchestrator = useMemo(
    () =>
      createOrchestrator(connector, {
        sessionId,
        cellSizePx,
        debug,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // Only create once
  );

  // React-specific component registry
  const componentRegistry = useMemo(
    () => new Map<string, React.ComponentType<VesselComponentProps>>(),
    [],
  );

  // Force re-render on state changes
  const [, forceRender] = useReducer((x) => x + 1, 0);

  // Keep refs to callbacks to avoid re-subscribing
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Subscribe to orchestrator state changes
  useEffect(() => {
    return orchestrator.subscribe(() => forceRender());
  }, [orchestrator]);

  // Subscribe to events
  useEffect(() => {
    return orchestrator.onEvent((event: MaelstromEvent) => {
      onEventRef.current?.(event);
    });
  }, [orchestrator]);

  // Connect on mount
  useEffect(() => {
    orchestrator.connect().catch((err) => {
      if (debug) {
        console.error('[Maelstrom] Connection error:', err);
      }
    });

    return () => {
      orchestrator.disconnect();
    };
  }, [orchestrator, debug]);

  // Dispatch wrapper
  const dispatch = useCallback(
    (action: StateAction) => {
      orchestrator.dispatch(action);
    },
    [orchestrator],
  );

  // Register vessel with React component
  const registerVessel = useCallback(
    (registration: VesselRegistration) => {
      orchestrator.getRegistry().register(registration.vessel);
      componentRegistry.set(registration.vessel.id, registration.component);
      forceRender();
    },
    [orchestrator, componentRegistry],
  );

  // Unregister vessel
  const unregisterVessel = useCallback(
    (vesselId: string) => {
      orchestrator.getRegistry().unregister(vesselId);
      componentRegistry.delete(vesselId);
      forceRender();
    },
    [orchestrator, componentRegistry],
  );

  // Process intent wrapper with callbacks
  const processIntent = useCallback(
    async (intent: string) => {
      try {
        const response = await orchestrator.processIntent(intent);
        onResponseRef.current?.(response);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onErrorRef.current?.(error);
      }
    },
    [orchestrator],
  );

  const value: MaelstromContextValue = {
    orchestrator,
    state: orchestrator.getState(),
    dispatch,
    componentRegistry,
    registerVessel,
    unregisterVessel,
    processIntent,
    cellSizePx,
    debug,
  };

  return (
    <MaelstromContext.Provider value={value}>
      {children}
    </MaelstromContext.Provider>
  );
}

// ============================================================================
// Context Hook
// ============================================================================

/**
 * Internal hook to access the Maelstrom context.
 * Use the hooks from './hooks' for public API.
 */
export function useMaelstromContext(): MaelstromContextValue {
  const context = useContext(MaelstromContext);
  if (!context) {
    throw new Error(
      'useMaelstromContext must be used within a MaelstromProvider',
    );
  }
  return context;
}
