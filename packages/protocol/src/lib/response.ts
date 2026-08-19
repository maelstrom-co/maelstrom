import type { ActionName } from './action-name.ts';
import type { InstanceId } from './instance.ts';
import type { MessageId } from './message.ts';
import type { VariantName } from './variant-name.ts';
import type { VesselId } from './vessel-id.ts';

// ---------------------------------------------------------------------------
// Action execution — parsed form (params as object, not JSON string)
// ---------------------------------------------------------------------------

/** Parsed instruction to invoke one Action on one Instance. */
export interface ActionExecution {
  /** Target Instance identity. */
  readonly instanceId: InstanceId;
  /** Action name valid for the Instance's current Variant. */
  readonly action: ActionName;
  /** Parsed Action parameters, omitted for a parameterless invocation. */
  readonly params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

/** Cell position and allocation for one visible Instance in grid mode. */
export interface GridPosition {
  /** Instance placed by this entry. */
  readonly instanceId: InstanceId;
  /** Zero-based Chart cell containing the allocation's top-left corner. */
  readonly position: { readonly row: number; readonly column: number };
  /** Allocation in Chart cells. */
  readonly size: { readonly width: number; readonly height: number };
}

/** Grid layout containing explicit positions for visible Instances. */
export interface GridLayout {
  /** Layout discriminator. */
  readonly type: 'grid';
  /** Position and allocation for each visible Instance. */
  readonly positions: readonly GridPosition[];
}

/** Instance declaration carried by a tiling layout. */
export interface TilingInstance {
  /** Instance identity referenced by tiling leaves. */
  readonly instanceId: InstanceId;
  /** Vessel implemented by the Instance. */
  readonly vesselId: VesselId;
  /** Current Variant after the response is applied. */
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

/** Tiling layout represented as a preorder binary tree plus Instance declarations. */
export interface TilingLayout {
  /** Layout discriminator. */
  readonly type: 'tiling';
  /** Preorder split, Instance, and empty-space nodes. */
  readonly tree: readonly TilingNode[];
  /** Complete Instance set retained after applying the layout. */
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

/** Engine decision returned for a Chart request. */
export interface MaelstromResponse {
  /** Response discriminator. */
  readonly type: 'maelstrom_response';
  /** Input message identity used for request correlation. */
  readonly requestId: MessageId;
  /** User-facing assistant text. */
  readonly userMessage: string;
  /** Engine rationale intended for diagnostics rather than user display. */
  readonly rationale: string;
  /** Ordered Actions to execute after applying the layout. */
  readonly executionPlan: readonly ActionExecution[];
  /** Grid or tiling layout selected for this response. */
  readonly layout: GridLayout | TilingLayout;
}
