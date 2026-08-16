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
 * Projects the Instance references eligible for rendering from a layout.
 *
 * This projection has no retained Instance store to resolve against. Callers
 * that need the Instances actually rendered must intersect the result with
 * their retained IDs.
 *
 * Grid visibility is every position. For tiling layouts, tokens are consumed
 * for the first preorder root: split operators require two children, `null`
 * fills a child slot without adding an Instance, and input may end with child
 * slots still missing. Encountered Instance leaves remain visible in a partial
 * or otherwise malformed root. Duplicate leaves are returned once in first
 * encounter order, while tokens trailing the parsed root are ignored.
 *
 * Tiling projection is iterative and stack-safe for deeply nested input. This
 * guarantee applies only to visibility projection, not to downstream parsers
 * or renderers. A null layout has no visible Instances.
 */
export function getVisibleInstanceIds(
  layout: GridLayout | TilingLayout | null,
): ReadonlySet<InstanceId> {
  if (layout === null) return new Set();

  return layout.type === 'grid'
    ? new Set(layout.positions.map(({ instanceId }) => instanceId))
    : collectVisibleTilingLeaves(layout.tree);
}

/**
 * Collects Instance leaves from the first preorder root without recursion.
 *
 * A pending child-slot count preserves parser consumption for complete and
 * partial roots without allocating in proportion to nesting depth. Missing
 * children end traversal when the tokens end; trailing tokens are left
 * unconsumed after the root fills its final slot.
 */
function collectVisibleTilingLeaves(
  tree: readonly TilingNode[],
): ReadonlySet<InstanceId> {
  const visible = new Set<InstanceId>();
  let pendingSlots = 1;

  for (const node of tree) {
    if (pendingSlots === 0) break;

    if (isTilingSplit(node)) {
      pendingSlots += 1;
    } else {
      pendingSlots -= 1;
      if (isInstanceIdNode(node)) visible.add(node);
    }
  }

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
