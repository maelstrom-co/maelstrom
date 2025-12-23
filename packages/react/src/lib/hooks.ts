import type {
  ChartDimensions,
  Vessel,
  VesselAction,
  VesselVariant,
} from '@maelstrom/protocol';
import type { VesselInstance } from '@maelstrom/client';
import { useCallback, useEffect, useMemo } from 'react';
import { useMaelstromContext } from './context';
import type {
  ConnectionState,
  VesselComponentProps,
  VesselRegistration,
} from './types';

// ============================================================================
// Core Hook
// ============================================================================

/**
 * Main hook for accessing Maelstrom functionality
 */
export function useMaelstrom() {
  const { state, processIntent, cellSizePx, debug, orchestrator } =
    useMaelstromContext();

  return {
    /** Process a user intent */
    processIntent,
    /** Current chart dimensions */
    chartDimensions: state.chartDimensions,
    /** Connection state */
    connectionState: state.connectionState,
    /** Whether a request is in flight */
    isProcessing: state.isProcessing,
    /** Last error message */
    lastError: state.lastError,
    /** Last engine response */
    lastResponse: state.lastResponse,
    /** All vessel instances */
    instances: Array.from(state.instances.values()),
    /** Cell size in pixels */
    cellSizePx,
    /** Debug mode enabled */
    debug,
    /** Session ID */
    sessionId: orchestrator.getConfig().sessionId,
  };
}

// ============================================================================
// Vessel Registration
// ============================================================================

/**
 * Register a vessel definition with its React component
 */
export function useVesselRegistration(registration: VesselRegistration): void {
  const { registerVessel, unregisterVessel } = useMaelstromContext();

  useEffect(() => {
    registerVessel(registration);
    return () => {
      unregisterVessel(registration.vessel.id);
    };
  }, [registerVessel, unregisterVessel, registration]);
}

/**
 * Get a registered vessel definition
 */
export function useVessel(vesselId: string): Vessel | undefined {
  const { orchestrator } = useMaelstromContext();
  return orchestrator.getRegistry().get(vesselId);
}

// ============================================================================
// Instance Management
// ============================================================================

/**
 * Create a new vessel instance
 */
export function useCreateInstance() {
  const { orchestrator, dispatch } = useMaelstromContext();

  return useCallback(
    (
      vesselId: string,
      options?: {
        instanceId?: string;
        variant?: string;
        position?: { row: number; column: number };
        size?: { width: number; height: number };
      },
    ): VesselInstance | null => {
      const vessel = orchestrator.getRegistry().get(vesselId);
      if (!vessel) {
        console.warn(`[Maelstrom] Vessel '${vesselId}' is not registered`);
        return null;
      }

      const variant = options?.variant || vessel.defaultVariant;
      const variantDef = vessel.variants[variant];

      if (!variantDef) {
        console.warn(
          `[Maelstrom] Variant '${variant}' not found on vessel '${vesselId}'`,
        );
        return null;
      }

      const instanceId = options?.instanceId || `${vesselId}-${Date.now()}`;
      const instance: VesselInstance = {
        instanceId,
        vesselId,
        variant,
        position: options?.position || { row: 0, column: 0 },
        size: options?.size || variantDef.minSize,
      };

      dispatch({ type: 'ADD_INSTANCE', instance });
      return instance;
    },
    [orchestrator, dispatch],
  );
}

/**
 * Get a vessel instance by ID
 */
export function useInstance(instanceId: string): VesselInstance | undefined {
  const { state } = useMaelstromContext();
  return state.instances.get(instanceId);
}

/**
 * Get all instances of a specific vessel type
 */
export function useInstancesByVessel(vesselId: string): VesselInstance[] {
  const { state } = useMaelstromContext();
  return useMemo(
    () =>
      Array.from(state.instances.values()).filter(
        (i) => i.vesselId === vesselId,
      ),
    [state.instances, vesselId],
  );
}

/**
 * Remove an instance
 */
export function useRemoveInstance() {
  const { dispatch } = useMaelstromContext();

  return useCallback(
    (instanceId: string) => {
      dispatch({ type: 'REMOVE_INSTANCE', instanceId });
    },
    [dispatch],
  );
}

// ============================================================================
// Instance State & Actions
// ============================================================================

/**
 * Get the current variant definition for an instance
 */
export function useInstanceVariant(
  instanceId: string,
): VesselVariant | undefined {
  const { state, orchestrator } = useMaelstromContext();
  const instance = state.instances.get(instanceId);
  if (!instance) return undefined;

  const vessel = orchestrator.getRegistry().get(instance.vesselId);
  if (!vessel) return undefined;

  return vessel.variants[instance.variant];
}

/**
 * Get available actions for an instance (based on current variant)
 */
export function useInstanceActions(instanceId: string): VesselAction[] {
  const variant = useInstanceVariant(instanceId);
  return variant?.actions || [];
}

/**
 * Execute an action on an instance
 */
export function useExecuteAction(instanceId: string) {
  const { dispatch, state, orchestrator } = useMaelstromContext();

  return useCallback(
    (actionName: string, params?: Record<string, unknown>) => {
      const instance = state.instances.get(instanceId);
      if (!instance) {
        console.warn(`[Maelstrom] Instance '${instanceId}' not found`);
        return;
      }

      const vessel = orchestrator.getRegistry().get(instance.vesselId);
      if (!vessel) {
        console.warn(
          `[Maelstrom] Vessel '${instance.vesselId}' not registered`,
        );
        return;
      }

      const variant = vessel.variants[instance.variant];
      if (!variant) {
        console.warn(`[Maelstrom] Variant '${instance.variant}' not found`);
        return;
      }

      const action = variant.actions.find((a) => a.name === actionName);
      if (!action) {
        console.warn(
          `[Maelstrom] Action '${actionName}' not available in variant '${instance.variant}'`,
        );
        return;
      }

      dispatch({
        type: 'EXECUTE_ACTION',
        execution: { instanceId, action: actionName, params },
        registry: orchestrator.getRegistry(),
      });
    },
    [instanceId, state, dispatch, orchestrator],
  );
}

// ============================================================================
// Chart Dimensions
// ============================================================================

/**
 * Get current chart dimensions
 */
export function useChartDimensions(): ChartDimensions {
  const { state } = useMaelstromContext();
  return state.chartDimensions;
}

/**
 * Update chart dimensions
 */
export function useSetChartDimensions() {
  const { dispatch } = useMaelstromContext();

  return useCallback(
    (dimensions: ChartDimensions) => {
      dispatch({ type: 'SET_CHART_DIMENSIONS', dimensions });
    },
    [dispatch],
  );
}

/**
 * Calculate chart dimensions from pixel viewport
 */
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

// ============================================================================
// Connection State
// ============================================================================

/**
 * Get connection state
 */
export function useConnectionState(): ConnectionState {
  const { state } = useMaelstromContext();
  return state.connectionState;
}

// ============================================================================
// Component Props Builder
// ============================================================================

/**
 * Build props for a vessel component
 */
export function useVesselComponentProps(
  instanceId: string,
): VesselComponentProps | null {
  const { state, orchestrator } = useMaelstromContext();
  const executeAction = useExecuteAction(instanceId);

  const instance = state.instances.get(instanceId);
  if (!instance) return null;

  const vessel = orchestrator.getRegistry().get(instance.vesselId);
  if (!vessel) return null;

  const variant = vessel.variants[instance.variant];
  if (!variant) return null;

  return {
    instance,
    variantProps: variant.props,
    executeAction,
  };
}
