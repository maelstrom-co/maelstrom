import type {
  ChartDimensions,
  Vessel,
  VesselAction,
  VesselInstance,
  VesselVariant,
} from '@maelstrom/protocol';
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
  const { state, processIntent, cellSizePx, debug, sessionId } =
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
    sessionId,
  };
}

// ============================================================================
// Vessel Registration
// ============================================================================

/**
 * Register a vessel definition with its React component
 */
export function useVesselRegistration(registration: VesselRegistration): void {
  const { dispatch } = useMaelstromContext();

  useEffect(() => {
    dispatch({ type: 'REGISTER_VESSEL', registration });
    return () => {
      dispatch({ type: 'UNREGISTER_VESSEL', vesselId: registration.vessel.id });
    };
  }, [dispatch, registration]);
}

/**
 * Get a registered vessel definition
 */
export function useVessel(vesselId: string): Vessel | undefined {
  const { state } = useMaelstromContext();
  return state.vessels.get(vesselId)?.vessel;
}

// ============================================================================
// Instance Management
// ============================================================================

/**
 * Create a new vessel instance
 */
export function useCreateInstance() {
  const { state, dispatch } = useMaelstromContext();

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
      const registration = state.vessels.get(vesselId);
      if (!registration) {
        console.warn(`[Maelstrom] Vessel '${vesselId}' is not registered`);
        return null;
      }

      const vessel = registration.vessel;
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
    [state.vessels, dispatch],
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
  const { state } = useMaelstromContext();
  const instance = state.instances.get(instanceId);
  if (!instance) return undefined;

  const registration = state.vessels.get(instance.vesselId);
  if (!registration) return undefined;

  return registration.vessel.variants[instance.variant];
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
  const { dispatch, state, emitEvent } = useMaelstromContext();

  return useCallback(
    (actionName: string, params?: Record<string, unknown>) => {
      const instance = state.instances.get(instanceId);
      if (!instance) {
        console.warn(`[Maelstrom] Instance '${instanceId}' not found`);
        return;
      }

      const registration = state.vessels.get(instance.vesselId);
      if (!registration) {
        console.warn(
          `[Maelstrom] Vessel '${instance.vesselId}' not registered`,
        );
        return;
      }

      const variant = registration.vessel.variants[instance.variant];
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

      emitEvent({
        type: 'action_started',
        instanceId,
        action: actionName,
        params,
        timestamp: Date.now(),
      });

      const startTime = Date.now();
      const fromVariant = instance.variant;

      dispatch({
        type: 'EXECUTE_ACTION',
        execution: { instanceId, action: actionName, params },
      });

      emitEvent({
        type: 'action_completed',
        instanceId,
        action: actionName,
        fromVariant,
        toVariant: action.transitionsTo || fromVariant,
        success: true,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      });
    },
    [instanceId, state, dispatch, emitEvent],
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
  const { state } = useMaelstromContext();
  const executeAction = useExecuteAction(instanceId);

  const instance = state.instances.get(instanceId);
  if (!instance) return null;

  const registration = state.vessels.get(instance.vesselId);
  if (!registration) return null;

  const variant = registration.vessel.variants[instance.variant];
  if (!variant) return null;

  return {
    instance,
    variantProps: variant.props,
    executeAction,
  };
}
