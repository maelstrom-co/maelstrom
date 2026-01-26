import {
  createOrchestrator,
  type MaelstromState,
  type Orchestrator,
  type StateAction,
} from '@maelstrom/client';
import type { MaelstromEvent } from '@maelstrom/protocol';
import {
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type {
  MaelstromProviderProps,
  VesselComponentProps,
  VesselLoadingSkeletonProps,
  VesselRegistration,
} from './types';
import { isLazyLoader } from './types';

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
  /** Loading component registry for lazy-loaded vessels */
  loadingRegistry: Map<string, React.ComponentType<VesselLoadingSkeletonProps>>;
  /** Tracks which vessels were registered with lazy loading */
  lazyVesselIds: Set<string>;
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
  // Create orchestrator when connector or sessionId changes
  // cellSizePx and debug are not passed here - they're used directly from props
  // in the context value, making them reactive without recreating the orchestrator
  const orchestrator = useMemo(
    () => createOrchestrator(connector, { sessionId }),
    [connector, sessionId],
  );

  // React-specific component registry
  const componentRegistry = useMemo(
    () => new Map<string, React.ComponentType<VesselComponentProps>>(),
    [],
  );

  // Track which vessels use lazy loading
  const lazyVesselIds = useMemo(() => new Set<string>(), []);

  // Loading component registry for lazy-loaded vessels
  const loadingRegistry = useMemo(
    () => new Map<string, React.ComponentType<VesselLoadingSkeletonProps>>(),
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

  // Register vessel with React component (supports both eager and lazy loading)
  const registerVessel = useCallback(
    (registration: VesselRegistration) => {
      // Always register vessel metadata (for LLM decisions)
      orchestrator.getRegistry().register(registration.vessel);

      const { id } = registration.vessel;
      const { component } = registration;

      // Check if this is a lazy loader or an eager component
      if (isLazyLoader(component)) {
        // Wrap with React.lazy() - this creates a lazy component
        // React.lazy() caches the resolved component internally
        const LazyComponent = lazy(component);
        componentRegistry.set(id, LazyComponent);
        lazyVesselIds.add(id);

        // Store the loading component if provided
        if (registration.loadingComponent) {
          loadingRegistry.set(id, registration.loadingComponent);
        } else {
          // Warn if lazy vessel doesn't have a custom loading component
          console.warn(
            `[Maelstrom] Lazy vessel "${id}" registered without a loading component. Using default skeleton.\nConsider providing a custom loading component via vesselRegistration().`,
          );
        }

        if (debug) {
          console.log(`[Maelstrom] Registered lazy vessel: ${id}`);
        }
      } else {
        // Eager component - store directly
        componentRegistry.set(id, component);

        if (debug) {
          console.log(`[Maelstrom] Registered eager vessel: ${id}`);
        }
      }

      forceRender();
    },
    [orchestrator, componentRegistry, loadingRegistry, lazyVesselIds, debug],
  );

  // Unregister vessel
  const unregisterVessel = useCallback(
    (vesselId: string) => {
      orchestrator.getRegistry().unregister(vesselId);
      componentRegistry.delete(vesselId);
      loadingRegistry.delete(vesselId);
      lazyVesselIds.delete(vesselId);
      forceRender();
    },
    [orchestrator, componentRegistry, loadingRegistry, lazyVesselIds],
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
    loadingRegistry,
    lazyVesselIds,
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
