import type { EngineConnector, VesselInstance } from '@maelstrom/client';
import type {
  MaelstromEvent,
  MaelstromResponse,
  Vessel,
} from '@maelstrom/protocol';
import type React from 'react';

// Re-export commonly used types from client for convenience
export type {
  AssistantMessage,
  ConnectionState,
  EngineConnector,
  MaelstromState,
  VesselInstance,
} from '@maelstrom/client';

// ============================================================================
// React-specific Types
// ============================================================================

/**
 * Function that dynamically imports a vessel component module.
 * Must return a module with a default export of the component.
 */
export type LazyVesselComponentLoader = () => Promise<{
  default: React.ComponentType<VesselComponentProps>;
}>;

/**
 * Links a Vessel definition to its React component.
 * Supports both eager and lazy loading patterns.
 */
export interface VesselRegistration {
  vessel: Vessel;
  /**
   * React component to render this vessel.
   * Can be either:
   * - An eager component (React.ComponentType<VesselComponentProps>)
   * - A lazy loader function (() => Promise<{ default: Component }>)
   */
  component:
    | React.ComponentType<VesselComponentProps>
    | LazyVesselComponentLoader;
  /**
   * Loading component to show while lazy-loading the vessel component.
   * Required when using lazy loading, ignored for eager components.
   */
  loadingComponent?: React.ComponentType<VesselLoadingSkeletonProps>;
}

/**
 * Props for the vessel loading skeleton
 */
export interface VesselLoadingSkeletonProps {
  /** The vessel ID being loaded */
  vesselId: string;
  /** The vessel name (for display) */
  vesselName?: string;
}

/**
 * Type guard to check if a component is a lazy loader function.
 * Lazy loaders are functions that return a Promise with a default export.
 */
export function isLazyLoader(
  component:
    | React.ComponentType<VesselComponentProps>
    | LazyVesselComponentLoader,
): component is LazyVesselComponentLoader {
  // Check if it's a function first
  if (typeof component !== 'function') {
    return false;
  }

  // Class components have prototype.isReactComponent
  if (component.prototype?.isReactComponent) {
    return false;
  }

  // Check for common React component markers
  // React.memo, forwardRef, etc. add $$typeof
  if ('$$typeof' in component) {
    return false;
  }

  // Function components typically have a length > 0 (props parameter)
  // Lazy loaders are () => Promise, so length === 0
  // However, some function components may have no params too
  // The most reliable check: lazy loaders don't have displayName set typically
  // and React components often have it, but this isn't guaranteed either

  // Best heuristic: if the function has no parameters and no React markers,
  // treat it as a lazy loader. Function components always receive props.
  return component.length === 0;
}

/**
 * Props passed to vessel React components.
 */
export interface VesselComponentProps {
  /** The vessel instance being rendered */
  instance: VesselInstance;
  /** Current variant's props */
  variantProps: Record<string, unknown>;
  /** Execute an action on this instance */
  executeAction: (actionName: string, params?: Record<string, unknown>) => void;
}

// ============================================================================
// Provider Config
// ============================================================================

export interface MaelstromProviderProps {
  /** Engine connector for communication */
  connector: EngineConnector;
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** Cell size in pixels (default: 80) */
  cellSizePx?: number;
  /** Enable debug mode */
  debug?: boolean;
  /** Event handler for Maelstrom events */
  onEvent?: (event: MaelstromEvent) => void;
  /**
   * Called when the engine returns a response.
   * Use this to handle userMessage (display in chat, speak via TTS, etc.)
   */
  onResponse?: (response: MaelstromResponse) => void;
  /**
   * Called when an error occurs during processing.
   */
  onError?: (error: Error) => void;
  /** Children */
  children: React.ReactNode;
}
