import {
  type LayoutMode,
  SessionId,
  type TilingLayout,
  type VesselDefinition,
} from '@maelstrom-co/protocol';
import type { ConnectionOptions } from '../connection-manager/connection-manager.types.js';
import type { IntentQueueOptions } from './intent-scheduler.types.js';

/**
 * Options that apply under every layout mode.
 *
 * {@link OrchestratorOptions} pairs these with the mode-specific
 * `layoutMode` / `initialLayout` fields.
 */
export interface OrchestratorOptionsBase {
  /** Mount-time bounded FIFO policy; invalid positive bounds throw at construction. */
  intentQueue?: IntentQueueOptions;
  /** Session ID for conversation continuity. Auto-generated if omitted. */
  sessionId?: SessionId;
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
  /**
   * Vessel definitions to register before
   * {@link TilingOrchestratorOptions.initialLayout} is validated and applied.
   * Equivalent to calling `vesselManager.registerVessel()` for each
   * immediately after construction — including its report-don't-throw
   * behavior: a definition that fails schema validation is skipped and
   * logged rather than aborting construction, so one bad vessel cannot take
   * down every other vessel. Registering here (rather than after
   * construction) exists so an `initialLayout` seed can reference these
   * vessels — the registry starts out empty otherwise. The one place this
   * still throws is indirect: if `initialLayout` names an instance whose
   * vessel failed validation (or was never listed here), construction
   * throws naming that instance and vessel — a seed genuinely cannot be
   * honored without the vessel it names.
   */
  vessels?: readonly VesselDefinition[];
}

/**
 * Options under the default tiling mode — the only mode that can seed a
 * first screen.
 */
export interface TilingOrchestratorOptions extends OrchestratorOptionsBase {
  /** Layout mode (default: 'tiling') */
  layoutMode?: 'tiling';
  /**
   * Layout applied once at construction, before any engine round-trip — a
   * *proposed* first screen. The engine sees it in the next chart request
   * and may reshape or drop tiles to fit the real viewport.
   *
   * Tiling-only, and typed that way: a grid layout can only reposition
   * instances that already exist, and none do yet at construction, so
   * {@link GridOrchestratorOptions} types `initialLayout` as `never`. The
   * constructor repeats both rules at runtime as a backstop for untyped
   * (JS) callers and `as` casts.
   *
   * Every instance the seed names must resolve to a vessel and variant
   * already registered via {@link OrchestratorOptionsBase.vessels}, every
   * `tree` leaf must be declared in `instances`, and every declared
   * instance must appear as a `tree` leaf; otherwise construction throws.
   *
   * Switching to grid later via `Orchestrator.setLayoutMode('grid')` is not
   * an error and does not undo the seed's own validity — but the stored
   * tiling layout can no longer be sent, so the next chart request carries
   * a fresh empty grid layout and the arranged board is discarded (with a
   * warning).
   */
  initialLayout?: TilingLayout;
}

/**
 * Options under grid mode, where no first screen can be seeded.
 */
export interface GridOrchestratorOptions extends OrchestratorOptionsBase {
  /** Layout mode. */
  layoutMode: 'grid';
  /**
   * Unavailable under grid mode. A seed has to *create* the instances it
   * arranges, which only a tiling tree expresses; grid positions can merely
   * move instances that already exist. Seed under
   * {@link TilingOrchestratorOptions.initialLayout} instead.
   */
  initialLayout?: never;
}

/**
 * Configuration options for the Orchestrator / Maelstrom client.
 *
 * `layoutMode` and `initialLayout` are one paired choice rather than two
 * independent fields: seeding a first screen is meaningful only under
 * tiling, so the grid arm makes `initialLayout` unrepresentable instead of
 * leaving that combination to a construction-time throw.
 */
export type OrchestratorOptions =
  | TilingOrchestratorOptions
  | GridOrchestratorOptions;

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
 * Layout mode applied when {@link TilingOrchestratorOptions.layoutMode} is
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
