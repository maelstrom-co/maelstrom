import { type LayoutMode, SessionId } from '@maelstrom-co/protocol';

import type { ConnectionOptions } from '../connection-manager/connection-manager.types.js';

/**
 * Configuration options for the Orchestrator / Maelstrom client.
 */
export interface OrchestratorOptions {
  /** Session ID for conversation continuity. Auto-generated if omitted. */
  sessionId?: SessionId;
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
 *
 * Every field is `readonly` because {@link Orchestrator.getConfig} hands out
 * the live object, not a copy: the Orchestrator replaces this object wholesale
 * when a setter changes a field (see `setLayoutMode`), so a caller writing
 * through the returned reference would bypass whatever else that setter owns
 * — and `sessionId` is captured-once identity that nothing may rewrite.
 */
export interface ResolvedOrchestratorOptions {
  readonly sessionId: SessionId;
  readonly layoutMode: LayoutMode;
  readonly debug: boolean;
  readonly debounceDelayMs: number;
  readonly maxWaitMs: number;
  readonly readyTimeoutMs: number;
  readonly connection: ConnectionOptions;
}

/**
 * Layout mode applied when {@link OrchestratorOptions.layoutMode} is
 * omitted. The one definition of that default — {@link resolveOrchestratorOptions}
 * consumes it internally, and consumers that need to know it (a "reset to
 * default" control, for example) should import this constant rather than
 * duplicating the literal.
 */
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'tiling';

/**
 * Resolves orchestrator options with defaults.
 */
export function resolveOrchestratorOptions(
  options: OrchestratorOptions = {},
): ResolvedOrchestratorOptions {
  return {
    sessionId: options.sessionId ?? SessionId(),
    layoutMode: options.layoutMode ?? DEFAULT_LAYOUT_MODE,
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
      stabilityThresholdMs: options.connection?.stabilityThresholdMs ?? 5000,
    },
  };
}

/**
 * View state snapshot of the orchestrator for UI consumption.
 */
export interface OrchestratorViewState {
  isProcessing: boolean;
  isConnected: boolean;
  sessionId: SessionId;
  layoutMode: LayoutMode;
}
