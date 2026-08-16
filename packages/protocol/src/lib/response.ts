import type { ActionName } from './action-name.ts';
import type { InstanceId } from './instance.ts';
import type { MessageId } from './message.ts';
import type { VariantName } from './variant-name.ts';
import type { VesselId } from './vessel-id.ts';

// ---------------------------------------------------------------------------
// Action execution — parsed form (params as object, not JSON string)
// ---------------------------------------------------------------------------

export interface ActionExecution {
  readonly instanceId: InstanceId;
  readonly action: ActionName;
  readonly params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Layout types
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
  readonly vesselId: VesselId;
  readonly variant: VariantName;
}

/** Binary split operator in the tiling tree: `H` (horizontal) or `V` (vertical). */
export type TilingSplit = 'H' | 'V';

/** A preorder tiling tree node: a split operator, a leaf instance ID, or null. */
export type TilingNode = TilingSplit | InstanceId | null;

/**
 * Positive narrowing predicate: true iff the node is an instance leaf.
 *
 * The wire shape (`'H' | 'V' | string | null`) makes `InstanceId` structurally
 * indistinguishable from the split operators at the value level, forcing
 * consumers to narrow by negation. This guard isolates that negation to one
 * place so call sites can read positively.
 */
export function isInstanceIdNode(node: TilingNode): node is InstanceId {
  return node !== null && node !== 'H' && node !== 'V';
}

/** True iff the node is a split operator (`'H'` or `'V'`). */
export function isTilingSplit(node: TilingNode): node is TilingSplit {
  return node === 'H' || node === 'V';
}

export interface TilingLayout {
  readonly type: 'tiling';
  readonly tree: readonly TilingNode[];
  readonly instances: readonly TilingInstance[];
}

/**
 * Projects the Instances rendered by a layout, rather than retained or merely
 * declared Instances.
 *
 * Grid visibility is every position. Tiling visibility is every instance leaf
 * in the first complete preorder tree — the same tokens the Chart consumes.
 * Trailing tokens after that tree are not visible. A null layout has no
 * visible Instances.
 */
export function getVisibleInstanceIds(
  layout: GridLayout | TilingLayout | null,
): ReadonlySet<InstanceId> {
  if (layout === null) return new Set();

  return layout.type === 'grid'
    ? new Set(layout.positions.map(({ instanceId }) => instanceId))
    : collectVisibleTilingLeaves(layout.tree);
}

// Walks one preorder tree the way Chart `parseTilingTree` does: consume a
// split's two children, treat a null as an empty leaf, and stop after the
// first complete root so trailing tokens cannot become visible.
function collectVisibleTilingLeaves(
  tree: readonly TilingNode[],
): ReadonlySet<InstanceId> {
  const visible = new Set<InstanceId>();
  let index = 0;

  const consumeNode = (): void => {
    if (index >= tree.length) return;
    const node = tree[index];
    index += 1;
    if (isTilingSplit(node)) {
      consumeNode();
      consumeNode();
      return;
    }
    if (isInstanceIdNode(node)) visible.add(node);
  };

  consumeNode();
  return visible;
}

// ---------------------------------------------------------------------------
// MaelstromResponse — the engine's output contract
// ---------------------------------------------------------------------------

export interface MaelstromResponse {
  readonly type: 'maelstrom_response';
  readonly requestId: MessageId;
  readonly userMessage: string;
  readonly rationale: string;
  readonly executionPlan: readonly ActionExecution[];
  readonly layout: GridLayout | TilingLayout;
}
