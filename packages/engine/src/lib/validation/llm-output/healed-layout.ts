import type {
  GridResponse,
  InstanceId,
  TilingNode,
  TilingSplitToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import { assertNever } from '../../assert-never.js';

/**
 * Mirrors the SkippedAction discriminated-union pattern: each `reason` arm
 * carries the kind-specific structured fields a consumer needs to describe
 * the drop without re-parsing strings. Tiling-tree drops use distinct top-
 * level reasons (`tree_*`) rather than a nested cause discriminator so a
 * single `switch (entry.reason)` exhausts the union — locked by
 * {@link formatDroppedEntry}'s `assertNever` default arm.
 */
export type DroppedLayoutEntry =
  | { readonly reason: 'unknown_instance'; readonly instanceId: InstanceId }
  | {
      readonly reason: 'unknown_vessel';
      readonly instanceId: InstanceId;
      readonly vesselId: VesselId;
    }
  | {
      readonly reason: 'unknown_variant';
      readonly instanceId: InstanceId;
      readonly variant: VariantName;
    }
  | {
      readonly reason: 'position_overflow';
      readonly instanceId: InstanceId;
      readonly row: number;
      readonly column: number;
      readonly width: number;
      readonly height: number;
      readonly chartColumns: number;
      readonly chartRows: number;
    }
  | {
      readonly reason: 'size_below_minimum';
      readonly instanceId: InstanceId;
      readonly width: number;
      readonly height: number;
      readonly minWidth: number;
      readonly minHeight: number;
    }
  | {
      readonly reason: 'duplicate_instance_id';
      readonly instanceId: InstanceId;
    }
  | { readonly reason: 'tree_missing_child'; readonly atTokenIndex: number }
  | {
      readonly reason: 'tree_duplicate_leaf';
      readonly atTokenIndex: number;
      readonly instanceId: InstanceId;
    }
  | {
      readonly reason: 'tree_orphan_reference';
      readonly atTokenIndex: number;
      readonly instanceId: InstanceId;
    }
  | {
      readonly reason: 'tree_extra_tokens';
      readonly fromTokenIndex: number;
      readonly count: number;
    }
  | {
      readonly reason: 'tree_split_truncated';
      readonly atTokenIndex: number;
      readonly declaredChildCount: number;
      readonly keptChildCount: number;
    };

/**
 * Tree-class drops carry token-position fields (`atTokenIndex`,
 * `fromTokenIndex`) the LLM never explicitly emitted. Consumers building
 * LLM-facing feedback collapse these to a single advisory rather than
 * citing useless indices; per-instance drops keep their structured detail.
 * The split is centralized via {@link isTreeDrop} so adding a new
 * `tree_*` arm requires updating one place.
 */
export type TreeDroppedLayoutEntry = Extract<
  DroppedLayoutEntry,
  { readonly reason: `tree_${string}` }
>;

export type InstanceDroppedLayoutEntry = Exclude<
  DroppedLayoutEntry,
  TreeDroppedLayoutEntry
>;

export const isTreeDrop = (
  entry: DroppedLayoutEntry,
): entry is TreeDroppedLayoutEntry => entry.reason.startsWith('tree_');

/**
 * Repairs, as distinct from drops: nothing was removed from the layout, so
 * these never belong in `droppedEntries`.
 *
 * A split token's arity is what its weight count says, so a malformed weight
 * suffix cannot be dropped — dropping the token would mean dropping subtrees
 * whose extent is exactly what could not be read. `weights` is the
 * substitution that was used instead.
 */
export type LayoutWarning =
  | { readonly kind: 'missing_rationale' }
  | {
      readonly kind: 'split_weights_repaired';
      readonly atTokenIndex: number;
      readonly token: TilingSplitToken;
      readonly weights: readonly number[];
    };

/**
 * Healed instance shape internal to the heal pipeline. All three IDs are
 * branded upstream by the protocol schemas' `.transform()` step, so
 * downstream readers (validIds set, AST leaves, drop entries, retry
 * prompt) carry the brands without re-casting.
 */
export interface HealedTilingInstance {
  readonly instanceId: InstanceId;
  readonly vesselId: VesselId;
  readonly variant: VariantName;
}

/**
 * Discriminated on `mode` so consumers reading the healed payload do not
 * need a parallel `mode` parameter. The `layout` shape is narrowed per-arm.
 * `droppedEntries` and `warnings` are shared across both modes.
 *
 * The tiling tree carries the branded `readonly TilingNode[]` shape: the
 * heal pipeline establishes the `H | V | InstanceId | null` invariant
 * internally (via `parseTree` / `pruneAst`), so consumers (`layoutEntryCount`,
 * `buildTilingLayout`) operate on the canonical type without per-element
 * casts.
 */
export interface HealedGridLayout {
  readonly mode: 'grid';
  readonly layout: GridResponse['layout'];
  readonly droppedEntries: readonly DroppedLayoutEntry[];
  readonly warnings: readonly LayoutWarning[];
}

export interface HealedTilingLayout {
  readonly mode: 'tiling';
  readonly layout: {
    readonly tree: readonly TilingNode[];
    readonly instances: readonly HealedTilingInstance[];
  };
  readonly droppedEntries: readonly DroppedLayoutEntry[];
  readonly warnings: readonly LayoutWarning[];
}

export type HealedLayout = HealedGridLayout | HealedTilingLayout;

export type RetrySeverity = 'none' | 'low' | 'medium' | 'unrecoverable';

/**
 * Discriminated union over the only valid `severity × recommend` pairs. The
 * impossible combinations (`{severity:'none', recommend:true}` and
 * `{severity:'unrecoverable', recommend:false}`) are unconstructable. The
 * recommendation predicate lives in `deriveRetryHint`; the type alone
 * prevents drift.
 */
export type RetryHint =
  | { readonly severity: 'none'; readonly recommend: false }
  | { readonly severity: 'low'; readonly recommend: false }
  | { readonly severity: 'medium'; readonly recommend: false }
  | { readonly severity: 'medium'; readonly recommend: true }
  | { readonly severity: 'unrecoverable'; readonly recommend: true };

/**
 * Renders a single-line description of a dropped layout entry. Used by the
 * engine's `'Response healed'` log and the retry layer's prompt builder.
 * The exhaustive `switch` with `assertNever` default is the runtime guard
 * that locks the `DroppedLayoutEntry` discriminator — adding a new arm
 * without updating this function breaks the build.
 */
export function formatDroppedEntry(entry: DroppedLayoutEntry): string {
  switch (entry.reason) {
    case 'unknown_instance':
      return `instance "${entry.instanceId}" not in request`;
    case 'unknown_vessel':
      return `instance "${entry.instanceId}" referenced unknown vessel "${entry.vesselId}"`;
    case 'unknown_variant':
      return `instance "${entry.instanceId}" referenced unknown variant "${entry.variant}"`;
    case 'position_overflow':
      return `instance "${entry.instanceId}" at (${entry.row},${entry.column}) size ${entry.width}x${entry.height} exceeds chart bounds (${entry.chartColumns}x${entry.chartRows})`;
    case 'size_below_minimum':
      return `instance "${entry.instanceId}" size ${entry.width}x${entry.height} below variant minimum ${entry.minWidth}x${entry.minHeight}`;
    case 'duplicate_instance_id':
      return `instance "${entry.instanceId}" appeared multiple times in layout`;
    case 'tree_missing_child':
      return `tiling tree split at token index ${entry.atTokenIndex} is missing a child`;
    case 'tree_duplicate_leaf':
      return `tiling tree references instance "${entry.instanceId}" more than once, at token index ${entry.atTokenIndex}`;
    case 'tree_orphan_reference':
      return `tiling tree references unknown instance "${entry.instanceId}" at token index ${entry.atTokenIndex}`;
    case 'tree_extra_tokens':
      return `tiling tree has ${entry.count} unconsumed token(s) from index ${entry.fromTokenIndex}`;
    case 'tree_split_truncated':
      return `tiling tree split at token index ${entry.atTokenIndex} declared ${entry.declaredChildCount} children, cut to ${entry.keptChildCount}`;
    default:
      return assertNever(entry, 'formatDroppedEntry');
  }
}

/**
 * Renders a single-line description of a layout repair. Used by the engine's
 * `'Response healed'` log and the retry layer's prompt builder, so a repair
 * the pipeline applied silently is legible to both the operator and the model
 * that emitted it.
 *
 * The exhaustive `switch` with `assertNever` default is the runtime guard that
 * locks the {@link LayoutWarning} discriminator, matching the lock
 * {@link formatDroppedEntry} provides for drops — adding a new arm without
 * updating this function breaks the build.
 */
export function formatLayoutWarning(warning: LayoutWarning): string {
  switch (warning.kind) {
    case 'missing_rationale':
      return 'response omitted its rationale';
    case 'split_weights_repaired':
      return `tiling tree split token "${warning.token}" at token index ${warning.atTokenIndex} had an unreadable weight suffix, read as ${warning.weights.join(',')}`;
    default:
      return assertNever(warning, 'formatLayoutWarning');
  }
}
