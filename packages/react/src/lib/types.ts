import type {
  MaelstromEvent,
  MaelstromResponse,
  Vessel,
} from '@maelstrom/protocol';
import type { EngineConnector, VesselInstance } from '@maelstrom/client';
import type React from 'react';

// Re-export commonly used types from client for convenience
export type {
  ConnectionState,
  EngineConnector,
  MaelstromState,
  VesselInstance,
} from '@maelstrom/client';

// ============================================================================
// React-specific Types
// ============================================================================

/**
 * Links a Vessel definition to its React component.
 */
export interface VesselRegistration {
  vessel: Vessel;
  /** React component to render this vessel */
  component: React.ComponentType<VesselComponentProps>;
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
