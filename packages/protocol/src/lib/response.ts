import type { InstanceId } from './instance.js';

// ---------------------------------------------------------------------------
// Action execution — parsed form (params as object, not JSON string)
// ---------------------------------------------------------------------------

export interface ActionExecution {
  readonly instanceId: InstanceId;
  readonly action: string;
  readonly params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Layout types (structural — no dependency on protocol-old)
// ---------------------------------------------------------------------------

export interface GridPosition {
  readonly instanceId: InstanceId;
  readonly position: { readonly row: number; readonly column: number };
  readonly size: { readonly width: number; readonly height: number };
}

export interface GridLayout {
  readonly type: 'grid';
  readonly positions: readonly GridPosition[];
}

export interface TilingInstance {
  readonly instanceId: InstanceId;
  readonly vesselId: string;
  readonly variant: string;
}

/** Binary split operator in the tiling tree: `H` (horizontal) or `V` (vertical). */
export type TilingSplit = 'H' | 'V';

/** A preorder tiling tree node: a split operator, a leaf instance ID, or null. */
export type TilingNode = TilingSplit | InstanceId | null;

export interface TilingLayout {
  readonly type: 'tiling';
  readonly tree: readonly TilingNode[];
  readonly instances: readonly TilingInstance[];
}

// ---------------------------------------------------------------------------
// MaelstromResponse — the engine's output contract
// ---------------------------------------------------------------------------

export interface MaelstromResponse {
  readonly type: 'maelstrom_response';
  readonly requestId: string;
  readonly userMessage: string;
  readonly rationale: string;
  readonly executionPlan: readonly ActionExecution[];
  readonly layout: GridLayout | TilingLayout;
}
