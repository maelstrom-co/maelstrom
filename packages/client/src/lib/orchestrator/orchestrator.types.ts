import type { LayoutMode } from '@maelstrom/protocol';

import type { ConnectionOptions } from '../connection-manager/connection-manager.types.js';

/**
 * Configuration options for the Orchestrator / Maelstrom client.
 */
export interface OrchestratorOptions {
  /** Session ID for conversation continuity. Auto-generated if omitted. */
  sessionId?: string;
  /** Layout mode (default: 'tiling') */
  layoutMode?: LayoutMode;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Debounce delay for update batching in ms (default: 300) */
  debounceDelayMs?: number;
  /** Maximum wait time before forcing an update flush in ms (default: 1000) */
  maxWaitMs?: number;
  /** Max wait time for instance readiness before skipping actions in ms (default: 500) */
  readyTimeoutMs?: number;
  /** Connection options for the ConnectionManager */
  connection?: Partial<ConnectionOptions>;
}

/**
 * Resolved configuration with defaults applied.
 */
export interface ResolvedOrchestratorOptions {
  sessionId: string;
  layoutMode: LayoutMode;
  debug: boolean;
  debounceDelayMs: number;
  maxWaitMs: number;
  readyTimeoutMs: number;
  connection: ConnectionOptions;
}

/**
 * Generates a unique session ID.
 */
export function generateSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

/**
 * Resolves orchestrator options with defaults.
 */
export function resolveOrchestratorOptions(
  options: OrchestratorOptions = {},
): ResolvedOrchestratorOptions {
  return {
    sessionId: options.sessionId || generateSessionId(),
    layoutMode: options.layoutMode ?? 'tiling',
    debug: options.debug ?? false,
    debounceDelayMs: options.debounceDelayMs ?? 300,
    maxWaitMs: options.maxWaitMs ?? 1000,
    readyTimeoutMs: options.readyTimeoutMs ?? 500,
    connection: {
      maxRetries: options.connection?.maxRetries ?? 5,
      initialDelayMs: options.connection?.initialDelayMs ?? 1000,
      maxDelayMs: options.connection?.maxDelayMs ?? 30000,
      backoffMultiplier: options.connection?.backoffMultiplier ?? 2,
      circuitBreakerTimeoutMs:
        options.connection?.circuitBreakerTimeoutMs ?? 60000,
    },
  };
}

/**
 * View state snapshot of the orchestrator for UI consumption.
 */
export interface OrchestratorViewState {
  isProcessing: boolean;
  isConnected: boolean;
  sessionId: string;
  layoutMode: LayoutMode;
}
