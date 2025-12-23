import type {
  ActionExecution,
  ChartDimensions,
  LayoutDirective,
  MaelstromResponse,
} from '@maelstrom/protocol';
import type { VesselRegistry } from './registry.js';
import type { ConnectionState, MaelstromState, VesselInstance } from './types.js';

// ============================================================================
// State Actions
// ============================================================================

export type StateAction =
  | { type: 'ADD_INSTANCE'; instance: VesselInstance }
  | {
      type: 'UPDATE_INSTANCE';
      instanceId: string;
      updates: Partial<VesselInstance>;
    }
  | { type: 'REMOVE_INSTANCE'; instanceId: string }
  | { type: 'SET_CHART_DIMENSIONS'; dimensions: ChartDimensions }
  | { type: 'SET_CONNECTION_STATE'; state: ConnectionState }
  | { type: 'SET_PROCESSING'; isProcessing: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'APPLY_LAYOUT'; directives: LayoutDirective[] }
  | { type: 'EXECUTE_ACTION'; execution: ActionExecution; registry: VesselRegistry }
  | { type: 'SET_LAST_RESPONSE'; response: MaelstromResponse | null };

// ============================================================================
// Initial State
// ============================================================================

export function createInitialState(): MaelstromState {
  return {
    instances: new Map(),
    layout: [],
    chartDimensions: { columns: 12, rows: 8 },
    connectionState: 'disconnected',
    isProcessing: false,
    lastError: null,
    lastResponse: null,
  };
}

// ============================================================================
// Reducer
// ============================================================================

export function stateReducer(
  state: MaelstromState,
  action: StateAction,
): MaelstromState {
  switch (action.type) {
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
      const vessel = action.registry.get(existing.vesselId);
      if (!vessel) return state;

      // Find the current variant's actions
      const currentVariant = vessel.variants[existing.variant];
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
