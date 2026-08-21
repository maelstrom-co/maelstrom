import type { ActionName } from './action-name.ts';
import type { InstanceId } from './instance.ts';
import type { MessageId } from './message.ts';
import { MAX_SPLIT_CHILDREN, MAX_SPLIT_WEIGHT } from './model-output-limits.ts';
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

/** Split axis in the tiling tree: `H` (horizontal) or `V` (vertical). */
export type TilingSplit = 'H' | 'V';

/**
 * A split token carrying an explicit weight suffix: an axis, a colon, then
 * comma-separated positive integers — `"V:1,1,1"`, `"H:2,1"`.
 *
 * The weight count **declares the token's arity**. `"V:1,1,1"` consumes the
 * next three subtrees from the preorder array, not two, and each child takes
 * `weight / sum(weights)` of the parent region.
 *
 * Weights are integers rather than decimals because integers normalized by
 * their sum are exact: `1,1,1` *is* thirds, where `0.33,0.33,0.33` leaves a
 * one-percent gap and reintroduces the inexactness weighted splits exist to
 * remove. Integers also keep the validity predicate total — no NaN, no
 * float-precision edge cases.
 *
 * The template literal admits any suffix, including malformed ones, so that a
 * prefixed token is never mistaken for an Instance ID leaf.
 * {@link parseTilingSplitToken} is where a suffix is interpreted.
 */
export type TilingWeightedSplit = `${TilingSplit}:${string}`;

/**
 * Any token that divides its region: a bare axis or a weighted axis.
 *
 * Bare `'H'` / `'V'` mean exactly `weights: [1, 1]` and stay the preferred
 * spelling for an even two-way split.
 */
export type TilingSplitToken = TilingSplit | TilingWeightedSplit;

/** A preorder tiling tree node: a split token, a leaf instance ID, or null. */
export type TilingNode = TilingSplitToken | InstanceId | null;

/** The axis and per-child weights a split token declares. */
export interface ParsedTilingSplit {
  /** The region is divided along this axis. */
  readonly axis: TilingSplit;
  /**
   * One weight per child, so `weights.length` is the token's arity. Always
   * between 2 and `MAX_SPLIT_CHILDREN` entries, each an integer between 1 and
   * `MAX_SPLIT_WEIGHT`.
   */
  readonly weights: readonly number[];
  /**
   * True when the token's suffix was not spelled as the grammar requires and
   * `weights` holds the repaired substitute rather than a faithful reading.
   * A field is well formed only when it is a plain positive integer with no
   * sign, no leading zero, and no exponent or radix prefix, so `"V:1e3,1"`
   * and `"V:+2,1"` are reported here even though they coerce to a number.
   * Consumers that report on model output surface this; consumers that only
   * need geometry can ignore it.
   */
  readonly repaired: boolean;
  /**
   * How many weight fields past `MAX_SPLIT_CHILDREN` the token declared and
   * this parse discarded.
   *
   * Non-zero means the token's arity was cut, so the subtrees those slots
   * would have consumed are re-parented onto an ancestor rather than
   * disappearing. That reshapes the tree, which is why consumers that report
   * on model output treat it as a drop rather than a repair.
   */
  readonly discardedChildCount: number;
}

/**
 * The second preorder occurrence of an Instance already used as a tree leaf.
 */
export interface DuplicateTilingLeaf {
  readonly instanceId: InstanceId;
  readonly atTokenIndex: number;
}

/**
 * Positive narrowing predicate: true iff the node names an Instance.
 *
 * A {@link TilingNode} arrives off the wire as a bare string, so a
 * {@link TilingSplitToken} is structurally indistinguishable from an
 * `InstanceId` at the value level and consumers must narrow by negation. The
 * split test is delegated to {@link isTilingSplit}, so this guard isolates
 * that negation to one place and call sites read positively.
 */
export function isInstanceIdNode(node: TilingNode): node is InstanceId {
  return node !== null && !isTilingSplit(node);
}

/**
 * True iff the node divides its region rather than naming an Instance.
 *
 * Claims every token with an `H` / `V` axis prefix, including one whose weight
 * suffix is malformed. A prefixed token read as an Instance ID leaf surfaces
 * as the unrelated "leaf not declared in layout.instances", so classification
 * deliberately precedes interpretation.
 */
export function isTilingSplit(node: TilingNode): node is TilingSplitToken {
  return node !== null && isTilingSplitTokenString(node);
}

/**
 * The one definition of what a split token looks like, for callers holding a
 * plain string rather than a {@link TilingNode}.
 *
 * Schemas, brand factories and test helpers all have to answer the same
 * question — arity-bearing split or Instance ID leaf — before a `TilingNode`
 * exists to ask it about. Answering it in more than one place lets a token be
 * branded an Instance ID in one layer and read as a split in another, which
 * surfaces as the unrelated "leaf not declared in layout.instances".
 */
export function isTilingSplitTokenString(
  value: string,
): value is TilingSplitToken {
  return SPLIT_TOKEN_PREFIX.test(value);
}

/**
 * Reads a split token's axis and arity, or returns null for a node that is not
 * a split token.
 *
 * Bare `'H'` / `'V'` parse as `weights: [1, 1]`, so an unweighted tree runs the
 * same arithmetic it always did. A malformed suffix is repaired rather than
 * rejected — a split node's arity is unknown until its weights are read, and
 * dropping the node would mean dropping subtrees whose extent cannot be
 * determined. Each field is clamped independently, with no rescaling: a
 * non-numeric or sub-1 field becomes 1, a fractional field rounds to the
 * nearest integer, a field above `MAX_SPLIT_WEIGHT` is capped, fewer than two
 * fields pad to two, and fields beyond `MAX_SPLIT_CHILDREN` are discarded.
 * `repaired` reports that any of that happened.
 *
 * An empty field declares nothing, so it is ignored rather than filled in:
 * `"V:1,1,"` is a two-way split, not a three-way one. Reading a stray comma
 * as an extra child would raise the token's arity, and arity is what advances
 * the preorder cursor, so a typo would silently steal the following subtree
 * from whichever ancestor owned it.
 *
 * @example
 * ```ts
 * parseTilingSplitToken('V');        // { axis: 'V', weights: [1, 1], repaired: false }
 * parseTilingSplitToken('V:1,1,1');  // { axis: 'V', weights: [1, 1, 1], repaired: false }
 * parseTilingSplitToken('V:abc');    // { axis: 'V', weights: [1, 1], repaired: true }
 * parseTilingSplitToken(null);       // null
 * ```
 */
export function parseTilingSplitToken(
  token: TilingSplitToken,
): ParsedTilingSplit;
export function parseTilingSplitToken(
  token: TilingNode,
): ParsedTilingSplit | null;
export function parseTilingSplitToken(
  token: TilingNode,
): ParsedTilingSplit | null {
  if (!isTilingSplit(token)) return null;

  const axis: TilingSplit = token.startsWith('H') ? 'H' : 'V';
  if (token.length === 1) {
    return {
      axis,
      weights: EVEN_BINARY_WEIGHTS,
      repaired: false,
      discardedChildCount: 0,
    };
  }

  const declaredFields = token.slice(2).split(',');
  const fields = declaredFields.filter((field) => field.trim() !== '');
  const discardedChildCount = Math.max(0, fields.length - MAX_SPLIT_CHILDREN);
  let repaired =
    fields.length !== declaredFields.length ||
    fields.length < 2 ||
    discardedChildCount > 0;
  const weights: number[] = [];

  for (const field of fields.slice(0, MAX_SPLIT_CHILDREN)) {
    const declared = Number(field);
    const weight = Number.isFinite(declared)
      ? Math.min(MAX_SPLIT_WEIGHT, Math.max(1, Math.round(declared)))
      : 1;
    if (!CANONICAL_WEIGHT_FIELD.test(field) || weight !== declared) {
      repaired = true;
    }
    weights.push(weight);
  }
  while (weights.length < 2) weights.push(1);

  return { axis, weights, repaired, discardedChildCount };
}

/**
 * Renders an axis and weights back into a token.
 *
 * Emits the bare axis for an even two-way split, so a tree that arrived
 * unweighted leaves any round trip through the parser unchanged.
 *
 * The parameter is a two-or-more tuple because a split with fewer children
 * than that is not a split: `[1]` would render `"V:1"`, which parses back as
 * an even two-way split and reports itself repaired, breaking the round trip
 * this function exists to preserve.
 */
export function formatTilingSplitToken(
  axis: TilingSplit,
  weights: readonly [number, number, ...number[]],
): TilingSplitToken {
  return weights.length === 2 && weights[0] === weights[1]
    ? axis
    : `${axis}:${weights.join(',')}`;
}

/**
 * Finds the first tree position that repeats an Instance leaf, or null when
 * every leaf is distinct.
 *
 * An Instance is one entry in the store with one Variant and one action
 * surface, and tiles are keyed by Instance ID, so a tree naming the same
 * Instance in two places describes something that cannot be rendered. The
 * first preorder occurrence is the legitimate one; this reports the repeat.
 *
 * The whole token array is scanned, including tokens trailing a completed
 * root, because a caller removing the repeat must not shift indices it has
 * not inspected.
 */
export function findDuplicateTilingLeaf(
  tree: readonly TilingNode[],
): DuplicateTilingLeaf | null {
  const seen = new Set<InstanceId>();

  for (let index = 0; index < tree.length; index++) {
    const node = tree[index];
    if (node === undefined || !isInstanceIdNode(node)) continue;
    if (seen.has(node)) return { instanceId: node, atTokenIndex: index };
    seen.add(node);
  }

  return null;
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
 * for the first preorder root: a split token requires as many children as its
 * weights declare, `null` fills a child slot without adding an Instance, and
 * input may end with child slots still missing. Encountered Instance leaves
 * remain visible in a partial or otherwise malformed root. Duplicate leaves
 * are returned once in first encounter order, while tokens trailing the
 * parsed root are ignored.
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

    const split = parseTilingSplitToken(node);
    if (split !== null) {
      pendingSlots += split.weights.length - 1;
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

const EVEN_BINARY_WEIGHTS: readonly number[] = Object.freeze([1, 1]);

/** Claims every axis-prefixed token, well formed or not. */
const SPLIT_TOKEN_PREFIX = /^[HV](:|$)/;

/** A weight field the grammar can read back verbatim: no sign, no leading
 * zero, no exponent, no radix prefix. */
const CANONICAL_WEIGHT_FIELD = /^[1-9]\d*$/;
