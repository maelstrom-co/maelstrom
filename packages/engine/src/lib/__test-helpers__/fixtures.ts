import type {
  ChartRequest,
  GridLayout,
  GridPosition,
  GridResponse,
  TilingInstance,
  TilingLayout,
  TilingNode,
  TilingResponse,
  Vessel,
  VesselAction,
  VesselInstanceSnapshot,
  VesselVariant,
} from '@maelstrom-co/protocol';
import {
  ActionName,
  InstanceId,
  isTilingSplitTokenString,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

import type { Logger } from '../logger.js';
import type { SkippedAction } from '../response/execution-plan/index.js';

/** Logger that discards every entry. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Negative-path schema-test helper. Wraps the `as unknown as T` double-cast
 * with a named call so test intent is explicit and a grep for
 * `as unknown as` in production code stays clean.
 */
export const invalid = <T>(v: unknown): T => v as T;

/**
 * Author-shape overrides for `ChartRequest` test fixtures. Accepts raw
 * strings for branded slots; the `build*` helpers below brand each field
 * through its smart constructor, so fixtures stay free of `as` escape hatches
 * and empty-string inputs fail fast at construction.
 */
type AuthorVesselAction = {
  readonly name: string;
  readonly description: string;
  readonly parameters?: ReadonlyArray<unknown>;
  readonly transitionsTo?: string;
  readonly idempotent?: boolean;
};
type AuthorVesselVariant = {
  readonly description?: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly minSize: { readonly width: number; readonly height: number };
  readonly actions: ReadonlyArray<AuthorVesselAction>;
};
/**
 * Raw-string author shape of a `Vessel`: ids, variant keys, action names and
 * `transitionsTo` are plain strings that `makeVessel` brands.
 */
export type AuthorVessel = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly defaultVariant: string;
  readonly variants: Readonly<Record<string, AuthorVesselVariant>>;
};

// ---------------------------------------------------------------------------
// Branding helpers — turn raw-string author shapes into branded protocol
// shapes at the fixture boundary. Smart constructors (`VesselId(...)` etc.)
// reject empty strings, so a malformed fixture fails at construction rather
// than slipping through an erased cast.
// ---------------------------------------------------------------------------

const brandAction = (action: AuthorVesselAction): VesselAction => ({
  name: ActionName(action.name),
  description: action.description,
  idempotent: action.idempotent ?? false,
  // `parameters` is author-typed as `unknown[]`; the schema's element shape
  // (`ActionParameter`) is irrelevant to fixtures that never assert on it.
  ...(action.parameters !== undefined
    ? { parameters: action.parameters as VesselAction['parameters'] }
    : {}),
  ...(action.transitionsTo !== undefined
    ? { transitionsTo: VariantName(action.transitionsTo) }
    : {}),
});

const brandVariant = (variant: AuthorVesselVariant): VesselVariant => ({
  ...(variant.description !== undefined
    ? { description: variant.description }
    : {}),
  props: variant.props,
  minSize: variant.minSize,
  actions: variant.actions.map(brandAction),
});

/**
 * Constructs a typed `Vessel` from a plain author shape, branding ids,
 * variant keys, action names, and `transitionsTo` via smart constructors.
 */
export function makeVessel(author: AuthorVessel): Vessel {
  const variants: Record<VariantName, VesselVariant> = {};
  for (const [name, variant] of Object.entries(author.variants)) {
    variants[VariantName(name)] = brandVariant(variant);
  }
  return {
    id: VesselId(author.id),
    name: author.name,
    description: author.description,
    defaultVariant: VariantName(author.defaultVariant),
    variants,
  };
}

export type AuthorInstanceSnapshot = {
  readonly instanceId: string;
  readonly vesselId: string;
  readonly variant: string;
};

const brandSnapshot = (
  snapshot: AuthorInstanceSnapshot,
): VesselInstanceSnapshot => ({
  instanceId: InstanceId(snapshot.instanceId),
  vesselId: VesselId(snapshot.vesselId),
  variant: VariantName(snapshot.variant),
});

const brandTilingInstance = (
  snapshot: AuthorInstanceSnapshot,
): TilingInstance => ({
  instanceId: InstanceId(snapshot.instanceId),
  vesselId: VesselId(snapshot.vesselId),
  variant: VariantName(snapshot.variant),
});

type AuthorGridPosition = {
  readonly instanceId: string;
  readonly position: { readonly row: number; readonly column: number };
  readonly size: { readonly width: number; readonly height: number };
};

const brandGridPosition = (pos: AuthorGridPosition): GridPosition => ({
  instanceId: InstanceId(pos.instanceId),
  position: pos.position,
  size: pos.size,
});

type AuthorTilingNode = 'H' | 'V' | string | null;
type ChartRequestAuthorOverrides = Partial<{
  readonly type: 'chart_request';
  readonly context: ChartRequest['context'];
  readonly instances: ReadonlyArray<AuthorInstanceSnapshot>;
  readonly vessels: ReadonlyArray<AuthorVessel>;
  readonly layout:
    | {
        readonly type: 'grid';
        readonly positions: ReadonlyArray<AuthorGridPosition>;
      }
    | {
        readonly type: 'tiling';
        readonly tree: ReadonlyArray<AuthorTilingNode>;
        readonly instances: ReadonlyArray<AuthorInstanceSnapshot>;
      };
}>;

const brandLayout = (
  layout: NonNullable<ChartRequestAuthorOverrides['layout']>,
): GridLayout | TilingLayout =>
  layout.type === 'grid'
    ? { type: 'grid', positions: layout.positions.map(brandGridPosition) }
    : {
        type: 'tiling',
        tree: brandTilingTree(layout.tree),
        instances: layout.instances.map(brandTilingInstance),
      };

const applyOverrides = (
  base: ChartRequest,
  overrides?: ChartRequestAuthorOverrides,
): ChartRequest =>
  overrides === undefined
    ? base
    : {
        type: overrides.type ?? base.type,
        context: overrides.context ?? base.context,
        instances: overrides.instances
          ? overrides.instances.map(brandSnapshot)
          : base.instances,
        vessels: overrides.vessels
          ? overrides.vessels.map(makeVessel)
          : base.vessels,
        layout: overrides.layout ? brandLayout(overrides.layout) : base.layout,
      };

/**
 * Builds a grid-mode `ChartRequest` holding one `calendar-main` instance of a
 * two-variant `calendar` Vessel on a 12x8 chart. Each override replaces its
 * whole field and is branded through the smart constructors.
 */
export function makeGridRequest(
  overrides?: ChartRequestAuthorOverrides,
): ChartRequest {
  return applyOverrides(
    {
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'Show me my calendar' }],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'grid',
      },
      instances: [
        brandSnapshot({
          instanceId: 'calendar-main',
          vesselId: 'calendar',
          variant: 'month',
        }),
      ],
      vessels: [
        makeVessel({
          id: 'calendar',
          name: 'Calendar',
          description: 'Displays events in various views',
          defaultVariant: 'month',
          variants: {
            month: {
              description: 'Monthly overview',
              props: {},
              minSize: { width: 4, height: 4 },
              actions: [
                {
                  name: 'showWeek',
                  description: 'Switch to week view',
                  transitionsTo: 'week',
                },
              ],
            },
            week: {
              description: 'Weekly detail view',
              props: {},
              minSize: { width: 6, height: 4 },
              actions: [
                {
                  name: 'showMonth',
                  description: 'Switch to month view',
                  transitionsTo: 'month',
                },
              ],
            },
          },
        }),
      ],
      layout: {
        type: 'grid',
        positions: [
          brandGridPosition({
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 6, height: 4 },
          }),
        ],
      },
    },
    overrides,
  );
}

/**
 * Builds a tiling-mode `ChartRequest` holding one `calendar-main` instance of
 * a single-variant `calendar` Vessel on a 12x8 chart. Each override replaces
 * its whole field and is branded through the smart constructors.
 */
export function makeTilingRequest(
  overrides?: ChartRequestAuthorOverrides,
): ChartRequest {
  return applyOverrides(
    {
      type: 'chart_request',
      context: {
        updateReasons: [{ type: 'user_intent', intent: 'Add a task list' }],
        chartDimensions: { columns: 12, rows: 8 },
        layoutMode: 'tiling',
      },
      instances: [
        brandSnapshot({
          instanceId: 'calendar-main',
          vesselId: 'calendar',
          variant: 'month',
        }),
      ],
      vessels: [
        makeVessel({
          id: 'calendar',
          name: 'Calendar',
          description: 'Displays events',
          defaultVariant: 'month',
          variants: {
            month: {
              props: {},
              minSize: { width: 4, height: 4 },
              actions: [],
            },
          },
        }),
      ],
      layout: {
        type: 'tiling',
        tree: [tilingLeafToken(InstanceId('calendar-main'))],
        instances: [
          brandTilingInstance({
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          }),
        ],
      },
    },
    overrides,
  );
}

// ---------------------------------------------------------------------------
// LLM-output response builders. The mock LLM returns the wire-shape
// `GridResponse` / `TilingResponse` whose ID slots are branded by the
// inferred schema type. These author shapes accept raw strings and brand
// every slot through its smart constructor, so fixtures stay free of `as`
// escape hatches and empty-string inputs fail at construction.
// ---------------------------------------------------------------------------

type AuthorActionExecution = {
  readonly instanceId: string;
  readonly action: string;
  readonly paramsJson?: string;
};

export type GridResponseAuthor = {
  readonly userMessage: string;
  readonly rationale: string;
  readonly executionPlan: ReadonlyArray<AuthorActionExecution>;
  readonly layout: {
    readonly positions: ReadonlyArray<AuthorGridPosition>;
  };
};

export type TilingResponseAuthor = {
  readonly userMessage: string;
  readonly rationale: string;
  readonly executionPlan: ReadonlyArray<AuthorActionExecution>;
  readonly layout: {
    readonly tree: ReadonlyArray<AuthorTilingNode>;
    readonly instances: ReadonlyArray<AuthorInstanceSnapshot>;
  };
};

const brandActionExecution = (
  exec: AuthorActionExecution,
): GridResponse['executionPlan'][number] => ({
  instanceId: InstanceId(exec.instanceId),
  action: ActionName(exec.action),
  ...(exec.paramsJson !== undefined ? { paramsJson: exec.paramsJson } : {}),
});

/**
 * Brands an author-written tree, the one place the split-token-versus-instance
 * rule is applied to a whole tree.
 */
export const brandTilingTree = (
  tree: ReadonlyArray<AuthorTilingNode>,
): TilingNode[] => tree.map(brandTilingNode);

/** Brands a complete grid LLM-output author shape into a typed `GridResponse`. */
export function brandGridResponse(author: GridResponseAuthor): GridResponse {
  return {
    userMessage: author.userMessage,
    rationale: author.rationale,
    executionPlan: author.executionPlan.map(brandActionExecution),
    layout: { positions: author.layout.positions.map(brandGridPosition) },
  };
}

/** Brands a complete tiling LLM-output author shape into a typed `TilingResponse`. */
export function brandTilingResponse(
  author: TilingResponseAuthor,
): TilingResponse {
  return {
    userMessage: author.userMessage,
    rationale: author.rationale,
    executionPlan: author.executionPlan.map(brandActionExecution),
    layout: {
      tree: brandTilingTree(author.layout.tree),
      instances: author.layout.instances.map(brandSnapshot),
    },
  };
}

/**
 * Builds the canonical single-instance grid LLM response, branding raw-string
 * overrides. Mirrors the default `makeGridRequest` fixture so a response built
 * here heals cleanly against it.
 */
export function buildGridResponse(
  overrides: Partial<GridResponseAuthor> = {},
): GridResponse {
  return brandGridResponse({
    userMessage: overrides.userMessage ?? 'Here is your calendar!',
    rationale: overrides.rationale ?? 'User asked for calendar',
    executionPlan: overrides.executionPlan ?? [],
    layout: overrides.layout ?? {
      positions: [
        {
          instanceId: 'calendar-main',
          position: { row: 0, column: 0 },
          size: { width: 6, height: 4 },
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Skipped-action builder. `SkippedAction` is a closed discriminated union
// whose per-arm fields use branded IDs; this builder brands a raw-string
// author shape per arm so diagnostics assertions stay free of `as` casts.
// ---------------------------------------------------------------------------

type AuthorSkippedAction =
  | {
      readonly reason: 'unknown_instance';
      readonly instanceId: string;
      readonly action: string;
    }
  | {
      readonly reason: 'unknown_vessel';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
    }
  | {
      readonly reason: 'no_simulated_variant';
      readonly instanceId: string;
      readonly action: string;
    }
  | {
      readonly reason: 'variant_not_on_vessel';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
      readonly variant: string;
    }
  | {
      readonly reason: 'action_not_valid';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
      readonly variant: string;
      readonly validActions: ReadonlyArray<string>;
    }
  | {
      readonly reason: 'params_parse_failed';
      readonly instanceId: string;
      readonly action: string;
    }
  | {
      readonly reason: 'params_validation_failed';
      readonly instanceId: string;
      readonly action: string;
      readonly issues: Extract<
        SkippedAction,
        { reason: 'params_validation_failed' }
      >['issues'];
    }
  | {
      readonly reason: 'state_drift';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
      readonly targetVariant: string;
    }
  | {
      readonly reason: 'self_transition_noop';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
      readonly currentVariant: string;
    }
  | {
      readonly reason: 'non_idempotent_on_resize';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
    }
  | {
      readonly reason: 'parameterized_on_resize';
      readonly instanceId: string;
      readonly action: string;
      readonly vesselId: string;
    };

/** Brands a raw-string `SkippedAction` author shape into the typed union. */
export function buildSkippedAction(author: AuthorSkippedAction): SkippedAction {
  switch (author.reason) {
    case 'unknown_instance':
    case 'no_simulated_variant':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
      };
    case 'unknown_vessel':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
        vesselId: VesselId(author.vesselId),
      };
    case 'variant_not_on_vessel':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
        vesselId: VesselId(author.vesselId),
        variant: VariantName(author.variant),
      };
    case 'action_not_valid':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
        vesselId: VesselId(author.vesselId),
        variant: VariantName(author.variant),
        validActions: author.validActions.map(ActionName),
      };
    case 'params_parse_failed':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
      };
    case 'params_validation_failed':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
        issues: author.issues,
      };
    case 'state_drift':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
        vesselId: VesselId(author.vesselId),
        targetVariant: VariantName(author.targetVariant),
      };
    case 'self_transition_noop':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
        vesselId: VesselId(author.vesselId),
        currentVariant: VariantName(author.currentVariant),
      };
    case 'non_idempotent_on_resize':
    case 'parameterized_on_resize':
      return {
        reason: author.reason,
        instanceId: InstanceId(author.instanceId),
        action: ActionName(author.action),
        vesselId: VesselId(author.vesselId),
      };
  }
}

/**
 * Brands an author-written tree token. Split tokens (bare or weighted) pass
 * through; anything else is an Instance ID and takes the leaf prefix, so a
 * fixture is written in instance IDs rather than in wire tokens.
 */
function brandTilingNode(node: AuthorTilingNode): TilingNode {
  if (node === null) return node;
  return isTilingSplitTokenString(node)
    ? node
    : tilingLeafToken(InstanceId(node));
}
