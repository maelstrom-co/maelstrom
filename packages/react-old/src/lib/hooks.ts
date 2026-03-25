import type {
  ActionRunner,
  ConnectionStatus,
  VesselInstance,
} from '@maelstrom-co/client';
import type {
  ChartDimensions,
  GridLayout,
  MaelstromResponse,
  TilingLayout,
  Vessel,
  VesselAction,
  VesselVariant,
} from '@maelstrom-co/protocol-old';
import { useStore } from '@tanstack/react-store';
import { useCallback, useEffect, useRef } from 'react';

import { useMaelstromContext } from './context.js';
import type { VesselComponentProps, VesselRegistration } from './types.js';

export function useMaelstrom(): {
  processIntent: (intent: string) => Promise<void>;
  addAssistantMessage: ((message: string) => Promise<void>) | undefined;
  chartDimensions: ChartDimensions;
  connectionStatus: ConnectionStatus;
  isProcessing: boolean;
  lastResponse: MaelstromResponse | null;
  lastError: Error | null;
  instances: Array<{
    instanceId: string;
    vesselId: string;
    variant: string;
    position: { row: number; column: number };
    size: { width: number; height: number };
  }>;
  cellSizePx: number;
  debug: boolean;
  sessionId: string;
} {
  const {
    commandProcessorStore,
    connectionManagerStore,
    requestCoordinatorStore,
    processIntent,
    cellSizePx,
    debug,
    orchestrator,
    connector,
  } = useMaelstromContext();

  const chartDimensions = useStore(
    orchestrator.chartManager.store,
    (state) => state.chartDimensions,
  );
  const connectionStatus = useStore(
    connectionManagerStore,
    (state) => state.connectionStatus,
  );
  const isProcessing = useStore(
    requestCoordinatorStore,
    (state) => state.isProcessing,
  );
  const lastResponse = useStore(
    requestCoordinatorStore,
    (state) => state.lastResponse,
  );
  const lastError = useStore(commandProcessorStore, (state) => state.lastError);
  const instances = useStore(commandProcessorStore, (state) =>
    Array.from(state.instances.values()),
  );

  const addAssistantMessage = useCallback(
    async (message: string): Promise<void> => {
      await orchestrator.addAssistantMessage(message);
    },
    [orchestrator],
  );

  const canAddAssistantMessage = 'addAssistantMessage' in connector;

  return {
    processIntent,
    addAssistantMessage: canAddAssistantMessage
      ? addAssistantMessage
      : undefined,
    chartDimensions,
    connectionStatus,
    isProcessing,
    lastResponse,
    lastError,
    instances,
    cellSizePx,
    debug,
    sessionId: orchestrator.getConfig().sessionId,
  };
}

export function useVesselRegistration(registration: VesselRegistration): void {
  const { registerVessel, unregisterVessel } = useMaelstromContext();

  // Keep a ref to the latest registration so the effect body always has the
  // most up-to-date vessel definition without re-running mount/unmount on
  // every data change (which would cause unregister→register churn and, if
  // the VesselManager were disposed mid-cycle, a crash).
  const registrationRef = useRef(registration);
  registrationRef.current = registration;

  const vesselId = registration.vessel.id;

  useEffect(() => {
    registerVessel(registrationRef.current);
    return () => {
      unregisterVessel(vesselId);
    };
    // vesselId is the stable identity; registerVessel/unregisterVessel are
    // stable callbacks from context. We intentionally exclude `registration`
    // from deps — its identity changing (e.g. on query refetch) should NOT
    // trigger a full unregister/re-register cycle.
  }, [registerVessel, unregisterVessel, vesselId]);
}

export function useVessel(vesselId: string): Vessel | undefined {
  const { orchestrator } = useMaelstromContext();
  return useStore(orchestrator.vesselManager.store, (state) =>
    state.vessels.get(vesselId),
  );
}

export function useInstance(instanceId: string): VesselInstance | undefined {
  const { commandProcessorStore } = useMaelstromContext();
  return useStore(commandProcessorStore, (state) =>
    state.instances.get(instanceId),
  );
}

export function useInstancesByVessel(vesselId: string): VesselInstance[] {
  const { commandProcessorStore } = useMaelstromContext();
  return useStore(commandProcessorStore, (state) =>
    Array.from(state.instances.values()).filter((i) => i.vesselId === vesselId),
  );
}

export function useInstanceVariant(
  instanceId: string,
): VesselVariant | undefined {
  const instance = useInstance(instanceId);
  const vessel = useVessel(instance?.vesselId ?? '');
  if (!instance || !vessel) return undefined;

  return vessel.variants[instance.variant];
}

export function useInstanceActions(instanceId: string): VesselAction[] {
  const variant = useInstanceVariant(instanceId);
  return variant?.actions || [];
}

export function useChartDimensions(): ChartDimensions {
  const { orchestrator } = useMaelstromContext();
  return useStore(
    orchestrator.chartManager.store,
    (state) => state.chartDimensions,
  );
}

export function useSetChartDimensions() {
  const { orchestrator } = useMaelstromContext();

  return useCallback(
    (dimensions: ChartDimensions) => {
      orchestrator.chartManager.setDimensions({ ...dimensions });
    },
    [orchestrator],
  );
}

export function useChartDimensionsFromViewport() {
  const { cellSizePx } = useMaelstromContext();
  const setDimensions = useSetChartDimensions();

  return useCallback(
    (viewportWidth: number, viewportHeight: number) => {
      const columns = Math.floor(viewportWidth / cellSizePx);
      const rows = Math.floor(viewportHeight / cellSizePx);
      setDimensions({ columns, rows });
    },
    [cellSizePx, setDimensions],
  );
}

export function useConnectionStatus(): ConnectionStatus {
  const { connectionManagerStore } = useMaelstromContext();
  return useStore(connectionManagerStore, (state) => state.connectionStatus);
}

export function useVesselComponentProps(
  instanceId: string,
): VesselComponentProps | null {
  const { debug, orchestrator } = useMaelstromContext();

  const instance = useInstance(instanceId);
  const vessel = useVessel(instance?.vesselId ?? '');

  const executeAction = useCallback(
    (actionName: string, params?: Record<string, unknown>) => {
      if (debug) {
        console.log(`[Maelstrom] executeAction: ${actionName}`, params);
      }
      void orchestrator.commandProcessor.executeActions([
        {
          instanceId,
          action: actionName,
          ...(params && { paramsJson: JSON.stringify(params) }),
        },
      ]);
    },
    [orchestrator, instanceId, debug],
  );

  if (!instance || !vessel) return null;

  const variant = vessel.variants[instance.variant];
  if (!variant) return null;

  return {
    instance,
    variantProps: variant.props,
    executeAction,
  };
}

/**
 * Register action handlers for a vessel instance.
 *
 * @param instanceId - Vessel instance ID
 * @param runner - Action handlers keyed by action name
 */
export function useVesselActions<V extends Vessel = Vessel>(
  instanceId: string,
  runner: ActionRunner<V>,
): void {
  const { orchestrator, debug } = useMaelstromContext();

  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  useEffect(() => {
    if (debug) {
      console.log(
        `[Maelstrom] Registering action runner for instance "${instanceId}"`,
      );
    }

    // Proxy delegates every call to the latest ref, keeping the ActionRunner<V> type
    const stableRunner = new Proxy(runnerRef.current, {
      get(_, prop: string) {
        return (runnerRef.current as Record<string, unknown>)[prop];
      },
    });

    orchestrator.commandProcessor.registerRunner(instanceId, stableRunner);

    return () => {
      if (debug) {
        console.log(
          `[Maelstrom] Unregistering action runner for instance "${instanceId}"`,
        );
      }
      orchestrator.commandProcessor.unregisterRunner(instanceId);
    };
  }, [instanceId, orchestrator, debug]);
}

export function useSetLayout() {
  const { orchestrator } = useMaelstromContext();

  return useCallback(
    (layout: GridLayout | TilingLayout) => {
      orchestrator.commandProcessor.setLayout(layout);
    },
    [orchestrator],
  );
}
