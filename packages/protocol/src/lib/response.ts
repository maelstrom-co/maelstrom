import type { ActionName } from './action-name.ts';
import { InstanceId } from './instance.ts';
import type { MessageId } from './message.ts';
import { MAX_SPLIT_CHILDREN, MAX_SPLIT_WEIGHT } from './model-output-limits.ts';
import type { TilingSplit, TilingSplitToken } from './tiling-split-token.ts';
import { isTilingSplitTokenString } from './tiling-split-token.ts';
import type { VariantName } from './variant-name.ts';
import type { VesselId } from './vessel-id.ts';

export type {
  TilingSplit,
  TilingSplitToken,
  TilingWeightedSplit,
} from './tiling-split-token.ts';
export { isTilingSplitTokenString } from './tiling-split-token.ts';

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

/**
 * The literal marker that opens a leaf token, separating the tiling grammar's
 * leaves from its split tokens.
 */
export const TILING_LEAF_PREFIX = 'ID:';

/**
 * A tiling-tree leaf: {@link TILING_LEAF_PREFIX} followed by the Instance ID
 * the leaf renders.
 *
 * The prefix is what makes a leaf a leaf. Without it the grammar would have to
 * separate leaves from splits by elimination, which puts every Instance whose
 * ID happens to start `H`/`V` — `"H:hero"`, and `"V"` itself — one string
 * comparison away from being read as an arity-two divider that consumes the
 * two subtrees behind it. Marking leaves instead of constraining Instance IDs
 * keeps the grammar's needs inside the grammar.
 *
 * The template literal admits `"ID:"` with nothing after it, mirroring
 * {@link TilingWeightedSplit}'s tolerance of a malformed suffix: classifying a
 * token is separate from reading one, and {@link tilingLeafInstanceId} is
 * where a leaf's payload is read.
 */
export type TilingLeafToken = `${typeof TILING_LEAF_PREFIX}${string}`;

/** A preorder tiling tree node: a split token, a leaf token, or null. */
export type TilingNode = TilingSplitToken | TilingLeafToken | null;

/**
 * Why a parsed split's `weights` differ from what its token spelled.
 *
 * `'truncated'` is a structural event and the others are not: the token
 * declared more children than a split may have, so the subtrees the discarded
 * slots would have consumed are re-parented onto an ancestor. `'unreadable'`
 * means a weight field was not spelled as the grammar requires and a
 * substitute value stands in its place. `'padded'` means the token declared
 * fewer than two weights, so the arity — not any declared value — was filled
 * in. Truncation is reported ahead of the other two when a token manages
 * both, because re-parenting is the consequential half.
 */
export type TilingSplitRepairReason = 'truncated' | 'unreadable' | 'padded';

/** The axis and per-child weights a split token declares. */
export interface ParsedTilingSplit {
  /** The region is divided along this axis. */
  readonly axis: TilingSplit;
  /**
   * One weight per child, so `weights.length` is the token's arity. Always
   * between 2 and `MAX_SPLIT_CHILDREN` entries, each an integer between 1 and
   * `MAX_SPLIT_WEIGHT`.
   *
   * The two-or-more tuple is the arity half of that invariant, stated in the
   * type: a consumer pairing each weight with a child slot can destructure
   * two of them without inventing a fallback for a split that has neither.
   */
  readonly weights: readonly [number, number, ...number[]];
  /**
   * True when the token's suffix was not spelled as the grammar requires and
   * `weights` holds the repaired substitute rather than a faithful reading.
   * A field is well formed only when it is a plain positive integer with no
   * sign, no leading zero, and no exponent or radix prefix, so `"V:1e3,1"`
   * and `"V:+2,1"` are reported here even though they coerce to a number.
   * Consumers that report on model output surface this; consumers that only
   * need geometry can ignore it.
   *
   * Equivalent to `repairReason !== null`, and never a sufficient basis for
   * an explanation on its own — a consumer that words a message from this
   * flag alone mis-describes the other repair kinds.
   */
  readonly repaired: boolean;
  /**
   * Which of the repairs `repaired` reports actually happened, or `null` when
   * the token was read faithfully.
   *
   * Consumers that render a message about model output branch on this rather
   * than on `repaired`, so the wording matches the defect.
   */
  readonly repairReason: TilingSplitRepairReason | null;
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
 * An occurrence of an Instance already used as a tree leaf earlier in
 * preorder.
 */
export interface DuplicateTilingLeaf {
  /** The Instance the tree names more than once. */
  readonly instanceId: InstanceId;
  /** Index of the repeat itself, never of the earlier legitimate occurrence. */
  readonly atTokenIndex: number;
}

/**
 * True iff the node is a leaf naming an Instance.
 *
 * Every class of node is recognised by what it is spelled like rather than by
 * what it is not, so a token belonging to no class stays in no class instead
 * of falling into whichever one was defined by elimination.
 * {@link tilingLeafInstanceId} reads the Instance out; this only classifies.
 */
export function isInstanceIdNode(node: TilingNode): node is TilingLeafToken {
  return node !== null && isTilingLeafTokenString(node);
}

/**
 * True iff the node divides its region rather than naming an Instance.
 *
 * Claims every token with an `H` / `V` axis prefix, including one whose weight
 * suffix is malformed, so classification precedes interpretation.
 */
export function isTilingSplit(node: TilingNode): node is TilingSplitToken {
  return node !== null && isTilingSplitTokenString(node);
}

/**
 * Tests whether `value` matches the leaf grammar, for code holding a plain
 * string rather than a parsed {@link TilingNode}.
 *
 * The bare prefix does not qualify: `"ID:"` names no Instance, and there is no
 * repair for an absent identity the way there is for an unreadable weight.
 */
export function isTilingLeafTokenString(
  value: string,
): value is TilingLeafToken {
  return (
    value.length > TILING_LEAF_PREFIX.length &&
    value.startsWith(TILING_LEAF_PREFIX)
  );
}

/**
 * Renders an Instance as the leaf token a tiling tree carries.
 *
 * @example
 * ```ts
 * // ['V', 'ID:calendar-main', 'ID:tasks-main']
 * ['V', tilingLeafToken(calendarId), tilingLeafToken(tasksId)];
 * ```
 */
export function tilingLeafToken(instanceId: InstanceId): TilingLeafToken {
  return `${TILING_LEAF_PREFIX}${instanceId}`;
}

/**
 * Reads the Instance a leaf names, or returns null for a node that is not a
 * leaf token.
 *
 * The counterpart of {@link parseTilingSplitToken}: a node that yields neither
 * an Instance here nor a split there occupies its slot as empty space.
 */
export function tilingLeafInstanceId(node: TilingNode): InstanceId | null {
  return node !== null && isTilingLeafTokenString(node)
    ? InstanceId(node.slice(TILING_LEAF_PREFIX.length))
    : null;
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
 * Every returned object carries all five fields; none is optional.
 *
 * @example
 * ```ts
 * // { axis: 'V', weights: [1, 1], repaired: false, repairReason: null, discardedChildCount: 0 }
 * parseTilingSplitToken('V');
 * // { axis: 'V', weights: [1, 1, 1], repaired: false, repairReason: null, discardedChildCount: 0 }
 * parseTilingSplitToken('V:1,1,1');
 * // { axis: 'V', weights: [1, 1], repaired: true, repairReason: 'unreadable', discardedChildCount: 0 }
 * parseTilingSplitToken('V:abc');
 * // null
 * parseTilingSplitToken(null);
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
      repairReason: null,
      discardedChildCount: 0,
    };
  }

  const { weightFields, discardedChildCount, blankFieldSeen } =
    readSplitWeightFields(token);
  let unreadable = blankFieldSeen;
  const weights: number[] = [];

  for (const field of weightFields) {
    const declared = Number(field);
    const weight = clampSplitWeight(field, declared);
    if (!CANONICAL_WEIGHT_FIELD.test(field) || weight !== declared) {
      unreadable = true;
    }
    weights.push(weight);
  }

  const padded = weights.length < 2;
  while (weights.length < 2) weights.push(1);
  // The loop above is the proof: nothing leaves it under two entries.
  const arity = weights as [number, number, ...number[]];

  const repairReason = pickSplitRepairReason({
    discardedChildCount,
    unreadable,
    padded,
  });
  return {
    axis,
    weights: arity,
    repaired: repairReason !== null,
    repairReason,
    discardedChildCount,
  };
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
 *
 * @throws {RangeError} If `weights` breaks the invariant
 *   {@link assertValidSplitWeights} enforces: fewer than 2 or more than
 *   `MAX_SPLIT_CHILDREN` entries, or an entry that is not an integer from 1
 *   to `MAX_SPLIT_WEIGHT`.
 */
export function formatTilingSplitToken(
  axis: TilingSplit,
  weights: readonly [number, number, ...number[]],
): TilingSplitToken {
  assertValidSplitWeights(weights);
  return weights.length === 2 && weights[0] === weights[1]
    ? axis
    : `${axis}:${weights.join(',')}`;
}

/**
 * Throws unless `weights` satisfies the invariant {@link ParsedTilingSplit}
 * documents: 2 to `MAX_SPLIT_CHILDREN` entries, each an integer from 1 to
 * `MAX_SPLIT_WEIGHT`.
 *
 * {@link parseTilingSplitToken} clamps its way to that invariant, so nothing
 * it returns can violate it — but the type is a plain `number[]`, and every
 * other path that builds a weighted split (a renderer's child list, a test
 * fixture, a healer rewriting an arity) type-checks fine with `0`, `-5` or
 * `1.5`. Those values do not fail loudly downstream; they produce a region
 * of zero or negative extent, or a normalizing sum that no longer divides the
 * parent cleanly. Construction is the last point where the offending value is
 * still attributable to the code that invented it.
 */
export function assertValidSplitWeights(weights: readonly number[]): void {
  if (weights.length < 2 || weights.length > MAX_SPLIT_CHILDREN) {
    throw new RangeError(
      `A split declares 2 to ${MAX_SPLIT_CHILDREN} weights, not ${weights.length}.`,
    );
  }
  for (const weight of weights) {
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_SPLIT_WEIGHT) {
      throw new RangeError(
        `Split weight ${weight} is out of range: expected an integer from 1 to ${MAX_SPLIT_WEIGHT}.`,
      );
    }
  }
}

/**
 * Reports every tree position that repeats an Instance leaf, in ascending
 * token order.
 *
 * An Instance is one entry in the store with one Variant and one action
 * surface, and tiles are keyed by Instance ID, so a tree naming the same
 * Instance in two places describes something that cannot be rendered. The
 * first preorder occurrence is the legitimate one; every later one is
 * reported here.
 *
 * Detection is all this owns: what to do with a repeat — blank it, drop it,
 * refuse the tree — is a healing policy that belongs to the layer applying it.
 *
 * The whole token array is scanned, including tokens trailing a completed
 * root, because a caller removing the repeats must not shift indices it has
 * not inspected.
 *
 * @internal
 */
export function findDuplicateTilingLeaves(
  tree: readonly TilingNode[],
): readonly DuplicateTilingLeaf[] {
  const seen = new Set<InstanceId>();
  const duplicates: DuplicateTilingLeaf[] = [];

  for (let index = 0; index < tree.length; index++) {
    const node = tree[index];
    const instanceId = node === undefined ? null : tilingLeafInstanceId(node);
    if (instanceId === null) continue;
    if (seen.has(instanceId)) {
      duplicates.push({ instanceId, atTokenIndex: index });
      continue;
    }
    seen.add(instanceId);
  }

  return duplicates;
}

/**
 * Reports the first tree position that repeats an Instance leaf, in
 * ascending token order, or `undefined` when every leaf is distinct.
 *
 * Equivalent to `findDuplicateTilingLeaves(tree).at(0)`, but exits at the
 * first repeat instead of scanning and collecting every one. Use this for a
 * gate that only needs to know whether a tree is refusable — a caller that
 * needs every repeat (to blank or drop each one) still needs
 * {@link findDuplicateTilingLeaves}.
 *
 * @param tree - The tiling tree to scan, in preorder.
 * @returns The first repeat, or `undefined` if `tree` names no Instance more
 * than once.
 *
 * @internal
 */
export function findFirstDuplicateTilingLeaf(
  tree: readonly TilingNode[],
): DuplicateTilingLeaf | undefined {
  const seen = new Set<InstanceId>();

  for (let index = 0; index < tree.length; index++) {
    const node = tree[index];
    const instanceId = node === undefined ? null : tilingLeafInstanceId(node);
    if (instanceId === null) continue;
    if (seen.has(instanceId)) return { instanceId, atTokenIndex: index };
    seen.add(instanceId);
  }

  return undefined;
}

/**
 * Renders the shared half of a duplicate-leaf refusal: which Instance
 * repeated, where, and what to do instead.
 *
 * The text opens with a verb so it reads as the predicate of whatever subject
 * the caller names, leaving a call site to supply only its own prefix — the
 * seed field or command it is refusing. Holding the wording in one place keeps
 * the guard and the sentence explaining it from drifting apart.
 *
 * @param duplicate - A repeat reported by {@link findDuplicateTilingLeaves} or
 * {@link findFirstDuplicateTilingLeaf}.
 * @returns The refusal's shared half, opening lowercase and ending in a full
 * stop.
 *
 * @internal
 */
export function describeDuplicateTilingLeaf(
  duplicate: DuplicateTilingLeaf,
): string {
  return `names instance "${duplicate.instanceId}" more than once (tree index ${duplicate.atTokenIndex}). An instance renders as exactly one tile — weight the split token instead of repeating the leaf.`;
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
      const instanceId = tilingLeafInstanceId(node);
      if (instanceId !== null) visible.add(instanceId);
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

function pickSplitRepairReason(repairs: {
  discardedChildCount: number;
  unreadable: boolean;
  padded: boolean;
}): TilingSplitRepairReason | null {
  if (repairs.discardedChildCount > 0) return 'truncated';
  if (repairs.unreadable) return 'unreadable';
  return repairs.padded ? 'padded' : null;
}

// A token's field count is model output, so nothing bounds it: a hostile
// suffix can spell hundreds of thousands of fields, of which only the first
// MAX_SPLIT_CHILDREN and a count of the rest ever reach the result. Splitting
// the suffix apart is the cheaper read at any plausible length, so short
// tokens take it and longer ones are walked comma by comma, allocating
// nothing per discarded field.
function readSplitWeightFields(token: TilingSplitToken): {
  weightFields: readonly string[];
  discardedChildCount: number;
  blankFieldSeen: boolean;
} {
  if (token.length <= MAX_EAGERLY_SPLIT_TOKEN_LENGTH) {
    const declaredFields = token.slice(2).split(',');
    const fields = declaredFields.filter((field) => field.trim() !== '');
    return {
      weightFields: fields.slice(0, MAX_SPLIT_CHILDREN),
      discardedChildCount: Math.max(0, fields.length - MAX_SPLIT_CHILDREN),
      blankFieldSeen: fields.length !== declaredFields.length,
    };
  }

  const weightFields: string[] = [];
  let fieldCount = 0;
  let blankFieldSeen = false;

  for (let start = 2; start <= token.length; ) {
    const comma = token.indexOf(',', start);
    const end = comma === -1 ? token.length : comma;
    if (isBlankRange(token, start, end)) {
      blankFieldSeen = true;
    } else {
      fieldCount += 1;
      if (weightFields.length < MAX_SPLIT_CHILDREN) {
        weightFields.push(token.slice(start, end));
      }
    }
    start = end + 1;
  }

  return {
    weightFields,
    discardedChildCount: Math.max(0, fieldCount - MAX_SPLIT_CHILDREN),
    blankFieldSeen,
  };
}

function clampSplitWeight(field: string, declared: number): number {
  if (Number.isFinite(declared)) {
    return Math.min(MAX_SPLIT_WEIGHT, Math.max(1, Math.round(declared)));
  }
  // A numeral the grammar reads but a double cannot hold overflows to
  // Infinity. That is an above-range weight, so it caps like any other rather
  // than falling to the substitute an unreadable field gets.
  return CANONICAL_WEIGHT_FIELD.test(field) ? MAX_SPLIT_WEIGHT : 1;
}

// Sticky, so a field is measured where it sits: `field.trim() === ''` would
// mean extracting the substring the counting walk exists to avoid. `\s` is
// specified as the set `String.prototype.trim` strips, so the two agree.
function isBlankRange(text: string, start: number, end: number): boolean {
  BLANK_RUN.lastIndex = start;
  BLANK_RUN.exec(text);
  return BLANK_RUN.lastIndex >= end;
}

const BLANK_RUN = /\s*/y;

/**
 * Longest token whose fields are cheaper to split apart than to walk.
 *
 * A well-formed token runs to about sixty characters, so anything past this
 * is malformed already and its field count is unbounded model output.
 */
const MAX_EAGERLY_SPLIT_TOKEN_LENGTH = 1024;

const EVEN_BINARY_WEIGHTS: readonly [number, number] = Object.freeze([1, 1]);

/** A weight field the grammar can read back verbatim: no sign, no leading
 * zero, no exponent, no radix prefix. */
const CANONICAL_WEIGHT_FIELD = /^[1-9]\d*$/;
