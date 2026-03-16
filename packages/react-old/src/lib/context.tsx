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
} from 'react';

import {
  type ConnectionManagerState,
  type EngineConnector,
  type MessageProcessingState,
  Orchestrator,
  type RequestCoordinatorState,
} from '@maelstrom-co/client';
import type { LayoutMode } from '@maelstrom-co/protocol-old';

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
  messageProcessorStore: Store<MessageProcessingState>;
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
  const orchestrator = useMemo(
    () =>
      new Orchestrator(connector, {
        ...(sessionId && { sessionId }),
        layoutMode,
        debug,
      }),
    [connector, sessionId, layoutMode, debug],
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

  const messageProcessorStore = orchestrator.messageProcessor.store;
  const connectionManagerStore = orchestrator.connectionManager.store;
  const requestCoordinatorStore = orchestrator.requestCoordinator.store;

  const onResponseRef = useRef(onResponse);
  onResponseRef.current = onResponse;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    orchestrator.connect().catch((err) => {
      if (debug) {
        console.error('[Maelstrom] Connection error:', err);
      }
    });

    return () => {
      void orchestrator.dispose();
    };
  }, [orchestrator, debug]);

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
      messageProcessorStore,
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
      messageProcessorStore,
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
