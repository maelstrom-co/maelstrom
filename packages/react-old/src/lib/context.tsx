import {
  type ConnectionManagerState,
  type EngineConnector,
  type CommandProcessingState,
  Orchestrator,
  type RequestCoordinatorState,
} from '@maelstrom-co/client';
import type { LayoutMode } from '@maelstrom-co/protocol-old';
import type { Store } from '@tanstack/store';
import {
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import type {
  MaelstromProviderProps,
  VesselComponentProps,
  VesselLoadingSkeletonProps,
  VesselRegistration,
} from './types.js';
import { isLazyLoader } from './types.js';

interface MaelstromContextValue {
  orchestrator: Orchestrator;
  connector: EngineConnector;
  commandProcessorStore: Store<CommandProcessingState>;
  connectionManagerStore: Store<ConnectionManagerState>;
  requestCoordinatorStore: Store<RequestCoordinatorState>;
  componentRegistry: Map<string, React.ComponentType<VesselComponentProps>>;
  loadingRegistry: Map<string, React.ComponentType<VesselLoadingSkeletonProps>>;
  lazyVesselIds: Set<string>;
  registerVessel: (registration: VesselRegistration) => void;
  unregisterVessel: (vesselId: string) => void;
  processIntent: (intent: string) => Promise<void>;
  cellSizePx: number;
  debug: boolean;
  layoutMode: LayoutMode;
  tilingPadding: number;
}

const MaelstromContext = createContext<MaelstromContextValue | null>(null);

export function MaelstromProvider({
  connector,
  sessionId,
  cellSizePx = 80,
  debug = false,
  layoutMode = 'tiling',
  tilingPadding = 8,
  onResponse,
  onError,
  children,
}: MaelstromProviderProps) {
  // orchestratorRef always points to the live instance for the current mount.
  // useState provides the initial value for the first render; the useEffect
  // below replaces it on every real mount (including StrictMode's remount).
  const orchestratorRef = useRef<Orchestrator>(
    new Orchestrator(connector, {
      ...(sessionId && { sessionId }),
      layoutMode,
      debug,
    }),
  );
  const [orchestrator, setOrchestrator] = useState(
    () => orchestratorRef.current,
  );

  const componentRegistry = useMemo(
    () => new Map<string, React.ComponentType<VesselComponentProps>>(),
    [],
  );

  const lazyVesselIds = useMemo(() => new Set<string>(), []);

  const loadingRegistry = useMemo(
    () => new Map<string, React.ComponentType<VesselLoadingSkeletonProps>>(),
    [],
  );

  const [, forceRender] = useReducer((x) => x + 1, 0);

  const commandProcessorStore = orchestrator.commandProcessor.store;
  const connectionManagerStore = orchestrator.connectionManager.store;
  const requestCoordinatorStore = orchestrator.requestCoordinator.store;

  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // biome-ignore lint/correctness/useExhaustiveDependencies: connector/sessionId/layoutMode are intentionally excluded the are stable module-level or useMemo values. Only debug can change at runtime.
  useEffect(() => {
    // Create a fresh Orchestrator on every real mount. This is the key fix
    // for React StrictMode: the cleanup from the first mount disposes the
    // orchestrator, and the remount needs a brand-new instance — not the
    // same disposed one that useState returns on remount.
    const instance = new Orchestrator(connector, {
      ...(sessionId && { sessionId }),
      layoutMode,
      debug,
    });
    orchestratorRef.current = instance;
    setOrchestrator(instance);

    instance.connect().catch((err) => {
      if (debug) {
        console.error('[Maelstrom] Connection error:', err);
      }
    });

    return () => {
      void instance.dispose();
    };
  }, [debug]);

  const registerVessel = useCallback(
    (registration: VesselRegistration) => {
      orchestrator.vesselManager.registerVessel(registration.vessel);

      const { id } = registration.vessel;
      const { component } = registration;

      if (isLazyLoader(component)) {
        const LazyComponent = lazy(component);
        componentRegistry.set(id, LazyComponent);
        lazyVesselIds.add(id);

        if (registration.loadingComponent) {
          loadingRegistry.set(id, registration.loadingComponent);
        } else {
          console.warn(
            `[Maelstrom] Lazy vessel "${id}" registered without a loading component. Using default skeleton.\nConsider providing a custom loading component via vesselRegistration().`,
          );
        }

        if (debug) {
          console.log(`[Maelstrom] Registered lazy vessel: ${id}`);
        }
      } else {
        componentRegistry.set(id, component);

        if (debug) {
          console.log(`[Maelstrom] Registered eager vessel: ${id}`);
        }
      }

      forceRender();
    },
    [orchestrator, componentRegistry, loadingRegistry, lazyVesselIds, debug],
  );

  const unregisterVessel = useCallback(
    (vesselId: string) => {
      orchestrator.vesselManager.unregisterVessel(vesselId);
      componentRegistry.delete(vesselId);
      loadingRegistry.delete(vesselId);
      lazyVesselIds.delete(vesselId);
      forceRender();
    },
    [orchestrator, componentRegistry, loadingRegistry, lazyVesselIds],
  );

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

  const value: MaelstromContextValue = useMemo(
    () => ({
      orchestrator,
      connector,
      commandProcessorStore,
      connectionManagerStore,
      requestCoordinatorStore,
      componentRegistry,
      loadingRegistry,
      lazyVesselIds,
      registerVessel,
      unregisterVessel,
      processIntent,
      cellSizePx,
      debug,
      layoutMode,
      tilingPadding,
    }),
    [
      orchestrator,
      connector,
      commandProcessorStore,
      connectionManagerStore,
      requestCoordinatorStore,
      componentRegistry,
      loadingRegistry,
      lazyVesselIds,
      registerVessel,
      unregisterVessel,
      processIntent,
      cellSizePx,
      debug,
      layoutMode,
      tilingPadding,
    ],
  );

  return (
    <MaelstromContext.Provider value={value}>
      {children}
    </MaelstromContext.Provider>
  );
}

export function useMaelstromContext(): MaelstromContextValue {
  const context = useContext(MaelstromContext);
  if (!context) {
    throw new Error(
      'useMaelstromContext must be used within a MaelstromProvider',
    );
  }
  return context;
}
