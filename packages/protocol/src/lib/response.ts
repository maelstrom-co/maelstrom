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

/** Grid allocation that resolves an Instance from retained client state. */
export interface GridPosition {
  /** Unknown IDs cannot create grid Instances and are dropped by layout application. */
  readonly instanceId: InstanceId;
  /** Model schemas reject fractions and negatives; Engine healing enforces bounds. */
  readonly position: { readonly row: number; readonly column: number };
  /** Engine healing enforces Chart bounds and the Variant minimum size. */
  readonly size: { readonly width: number; readonly height: number };
}

/** Cell-based layout reconciled against already-retained Instance metadata. */
export interface GridLayout {
  /** Must agree with the request's `layoutMode`. */
  readonly type: 'grid';
  /** Only listed, known Instances remain visible after reconciliation. */
  readonly positions: readonly GridPosition[];
}

/** Retained tiling Instance metadata, whether or not the tree renders it. */
export interface TilingInstance {
  /** Stable retained identity that may be absent from the tree or used by several leaves. */
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

/** Tiling layout with separate tree visibility and retained Instance metadata. */
export interface TilingLayout {
  /** Must agree with the request's `layoutMode`. */
  readonly type: 'tiling';
  /** First preorder root controls visibility; `null` reserves an empty region. */
  readonly tree: readonly TilingNode[];
  /** Complete retained set, including Instances hidden by omission from the tree. */
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

/** Healed Chart decision whose layout is applied before its Action plan. */
export interface MaelstromResponse {
  /** Wire discriminator for a Maelstrom Chart response. */
  readonly type: 'maelstrom_response';
  /** Echoes the input message ID and matches the enclosing output correlation ID. */
  readonly requestId: MessageId;
  /** Assistant text intended for display and optional speech output. */
  readonly userMessage: string;
  /** Engine rationale intended for diagnostics rather than user display. */
  readonly rationale: string;
  /** Applied after layout; order is preserved only within each target Instance. */
  readonly executionPlan: readonly ActionExecution[];
  /** Uses the same mode requested in the Chart context after successful healing. */
  readonly layout: GridLayout | TilingLayout;
}
