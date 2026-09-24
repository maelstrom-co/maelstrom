import type { Stage } from '@maelstrom-co/engine';
import {
  getVisibleInstanceIds,
  isErr,
  type TilingNode,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import { checkArrangement } from '../eval/predicates.js';
import type { Scenario } from '../eval/scenarios.js';
import { scoreLayout } from '../eval/score.js';
import { finalVariants } from '../src/lib/final-variants.js';
import { layoutFits } from '../src/lib/layout-fit.js';
import {
  type ComposedPairsRecord,
  layoutComposedPairs,
  layoutComposedPairsWithDirection,
  layoutComposedPairsWithOptions,
} from '../src/lib/stages-experimental/layout-composed-pairs.js';
import {
  COMPOSED_PAIRS_BOTH_FIXES_OPTIONS,
  layoutComposedPairsGateAndDefer,
} from '../src/lib/stages-experimental/layout-composed-pairs-gate-and-defer.js';
import { layoutPreset } from '../src/lib/stages-experimental/layout-preset.js';
import { layoutPresetOrLlm } from '../src/lib/stages-experimental/layout-preset-or-llm.js';
import type {
  GateAnswer,
  GatedActionPlan,
  LayoutDecision,
  LayoutSource,
} from '../src/lib/stages-experimental/types.js';
import type { AnswerRecord } from '../src/lib/types.js';
import type { Ask } from '../src/lib/typesafe-client.js';
import { goldInputs, layoutDeferralGoldInputs } from './gold-inputs.js';
import {
  renderArrangementNotAskedSection,
  renderComposedPairsSection,
} from './layout-report.js';
import {
  checkPairAnswers,
  type PairsAnswerCheck,
} from './pairs-attribution.js';
import type { RecordedSpatialSignal } from './recorded-spatial.js';
import type { Judgement, StageEvalModule } from './stage-eval.js';

/** A layout decision as some stages return it, with the composed-pairs record. */
export type LayoutOutput = LayoutDecision & {
  readonly pairwise?: ComposedPairsRecord;
};

/** What the layout stage eval records of one decision. */
export interface LayoutTurnDetail {
  readonly source: LayoutSource;
  readonly layoutId?: string;
  /** Absent when the decision handed the layout off. */
  readonly tree?: readonly TilingNode[];
  readonly answers: readonly AnswerRecord[];
  /** The composed-pairs stages only. */
  readonly pairwise?: ComposedPairsRecord;
  /** `layoutComposedPairs` calls only: every pair against the scenario's reference tree, or why it cannot be compared. */
  readonly pairCheck?: PairsAnswerCheck | { readonly unavailable: string };
  /**
   * Present on a turn that asks no arrangement: a scenario not tagged
   * spatial, expecting an output, whose visible Instances are the current
   * tree's and whose current tree fits. `changed` is whether the returned
   * tree differs from the current one.
   */
  readonly arrangementNotAsked?: { readonly changed: boolean };
}

type LayoutVariant = (ask: Ask) => Stage<GatedActionPlan, LayoutOutput>;

const COMBINED = {
  direction: 'redirects_not_stated',
  sizeFallback: true,
  wholeBoardExamples: true,
} as const;

// Chosen from the spatial gate the live composed-pairs-inline arm answered
// on the development suite, before any run of the variant: the lowest
// probability a scenario tagged spatial got was 0.22 (reverse-order), and
// 0.2 is the 0.05 step below it.
const CONFIDENT_SPATIAL_NO_BELOW = 0.2;

/**
 * Layout stage variants by descriptive name; the composed-pairs ones are
 * the steps that led to `composed-pairs-gate-and-defer-combined`, the
 * layout stage of the `jev-gated-per-instance-composed-pairs-gate-and-defer-inline`
 * arm. Each `composed-pairs-` fix changes one thing from `composed-pairs`
 * (the redirect builds on `composed-pairs-with-direction`), see
 * `ComposedPairsOptions`. `composed-pairs-combined` stacks the fixes that
 * passed the development stage eval: the direction redirect, the size
 * fallback and the whole-board examples. `composed-pairs-fraction-sizes`
 * also asks sizes as fractions within each row or column, see
 * `SizeAnswers`. `composed-pairs-combined-limited-redirect` redirects not
 * stated only when the direction answer changes the top split;
 * `composed-pairs-fraction-sizes-proportional-fallback` splits what stated
 * fractions leave by whole-Chart shares; `composed-pairs-fraction-sizes-both-fixes`
 * does both. The `composed-pairs-fraction-sizes-both-fixes-` variants each
 * change one thing from it: `-always-asks` never keeps the current tree on
 * the spatial gate alone, `-weak-gate` keeps it only on a confident no, and
 * `-defers-when-nothing-fits` defers as `layoutPresetOrLlm` does when no
 * tree fits instead of handing off. `composed-pairs-gate-and-defer-combined`
 * stacks `-always-asks` and `-defers-when-nothing-fits`: on the stage eval
 * with the recorded live spatial signal `-always-asks` passed as often as
 * `-weak-gate`, whose threshold was picked from those same records.
 */
export const LAYOUT_VARIANTS: Readonly<Record<string, LayoutVariant>> = {
  preset: (ask) => layoutPreset(ask, { describe: 'placements' }),
  'preset-or-llm': layoutPresetOrLlm,
  'composed-pairs': (ask) => layoutComposedPairs(ask),
  'composed-pairs-with-direction': (ask) =>
    layoutComposedPairsWithDirection(ask),
  'composed-pairs-direction-redirects-not-stated': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      layoutId: 'composed-pairs-direction-redirects-not-stated',
      direction: 'redirects_not_stated',
    }),
  'composed-pairs-size-fallback': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      layoutId: 'composed-pairs-size-fallback',
      sizeFallback: true,
    }),
  'composed-pairs-whole-board-examples': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      layoutId: 'composed-pairs-whole-board-examples',
      wholeBoardExamples: true,
    }),
  'composed-pairs-combined': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMBINED,
      layoutId: 'composed-pairs-combined',
    }),
  'composed-pairs-fraction-sizes': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMBINED,
      layoutId: 'composed-pairs-fraction-sizes',
      sizeAnswers: { kind: 'fractions_within_part' },
    }),
  'composed-pairs-combined-limited-redirect': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMBINED,
      layoutId: 'composed-pairs-combined-limited-redirect',
      direction: 'redirects_not_stated_when_direction_changes',
    }),
  'composed-pairs-fraction-sizes-proportional-fallback': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMBINED,
      layoutId: 'composed-pairs-fraction-sizes-proportional-fallback',
      sizeAnswers: {
        kind: 'fractions_within_part',
        unstatedSplit: 'whole_chart_shares',
      },
    }),
  'composed-pairs-fraction-sizes-both-fixes': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMPOSED_PAIRS_BOTH_FIXES_OPTIONS,
      layoutId: 'composed-pairs-fraction-sizes-both-fixes',
    }),
  'composed-pairs-fraction-sizes-both-fixes-always-asks': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMPOSED_PAIRS_BOTH_FIXES_OPTIONS,
      layoutId: 'composed-pairs-fraction-sizes-both-fixes-always-asks',
      spatialGate: 'never_skips',
    }),
  'composed-pairs-fraction-sizes-both-fixes-weak-gate': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMPOSED_PAIRS_BOTH_FIXES_OPTIONS,
      layoutId: 'composed-pairs-fraction-sizes-both-fixes-weak-gate',
      spatialGate: { kind: 'confident_no', below: CONFIDENT_SPATIAL_NO_BELOW },
    }),
  'composed-pairs-fraction-sizes-both-fixes-defers-when-nothing-fits': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMPOSED_PAIRS_BOTH_FIXES_OPTIONS,
      layoutId:
        'composed-pairs-fraction-sizes-both-fixes-defers-when-nothing-fits',
      nothingFits: 'defers',
    }),
  'composed-pairs-gate-and-defer-combined': layoutComposedPairsGateAndDefer,
};

/** The deferral reason a scenario that expects the layout stage to defer expects. */
export const EXPECTED_LAYOUT_DEFERRAL = 'jevLayout/no_feasible_layout';

/** Where {@link layoutStageEvalWith} takes the stage's spatial gate from. */
export interface LayoutStageEvalOptions {
  /**
   * The spatial gate a live planner answered, per scenario turn; a turn it
   * holds no gate for keeps the gold gate. Every gate is gold when absent.
   */
  readonly spatialSignal?: RecordedSpatialSignal;
}

/**
 * The layout stage on gold inputs: each scenario's expected selection and
 * action plan with every gate (see `goldInputs`), or, for a scenario that
 * expects the layout stage to defer, the board as it is (see
 * `layoutDeferralGoldInputs`). With `spatialSignal` the spatial gate of
 * each turn is the recorded live one where there is one. A decision with a
 * tree passes when the tree's leaves are the expected visible set, the
 * arrangement rules hold and the tree fits the Chart and every minimum
 * size; a decision without a tree is handed off. A scenario that expects
 * a layout deferral passes only on {@link EXPECTED_LAYOUT_DEFERRAL}.
 */
export function layoutStageEvalWith(
  options: LayoutStageEvalOptions = {},
): StageEvalModule<GatedActionPlan, LayoutOutput, LayoutTurnDetail> {
  const { spatialSignal } = options;
  return {
    stage: 'jevLayout',
    variants: LAYOUT_VARIANTS,
    prepare: async (scenario, ctx) => {
      const gold = expectsLayoutDeferral(scenario)
        ? layoutDeferralGoldInputs(scenario, 'gated')
        : goldInputs(scenario, 'gated');
      if (!gold.applicable) return gold;
      const { jevSelect, jevActions } = gold.stages;
      if (jevSelect === undefined || jevActions === undefined)
        return { applicable: false, reason: 'gold inputs formed no stages' };
      const selection = await jevSelect(ctx.origin, ctx);
      if (isErr(selection))
        return { applicable: false, reason: 'the gold selection failed' };
      const plan = await jevActions(selection.value, ctx);
      if (isErr(plan))
        return { applicable: false, reason: 'the gold action plan failed' };
      return {
        applicable: true,
        input: plan.value as GatedActionPlan,
        origin: ctx.origin,
      };
    },
    ...(spatialSignal && {
      turnInput: (scenario, repeat, input) => {
        const spatial = spatialSignal.lookup(scenario.id, repeat);
        return spatial === undefined ? input : withSpatialGate(input, spatial);
      },
    }),
    expectedDeferral: (scenario) =>
      expectsLayoutDeferral(scenario) ? EXPECTED_LAYOUT_DEFERRAL : undefined,
    judge: judgeLayout,
    reportSections: (records, variants) =>
      [
        renderArrangementNotAskedSection(records, variants),
        renderComposedPairsSection(records, variants),
      ].flatMap((section) => section ?? []),
  };
}

/** {@link layoutStageEvalWith} with every gate gold. */
export const layoutStageEval = layoutStageEvalWith();

/** Scores one layout decision on `input` against `scenario` (see {@link layoutStageEval}). */
export function judgeLayout(
  scenario: Scenario,
  input: GatedActionPlan,
  output: LayoutOutput,
): Judgement<LayoutTurnDetail> {
  const recorded: LayoutTurnDetail = {
    source: output.source,
    ...(output.layoutId !== undefined && { layoutId: output.layoutId }),
    ...(output.tree !== undefined && { tree: output.tree }),
    answers: output.answers,
    ...(output.pairwise && { pairwise: output.pairwise }),
  };
  const pairCheck = output.pairwise?.called
    ? comparePairs(scenario, output.pairwise, output.tree)
    : undefined;
  const failures =
    output.tree === undefined ? [] : treeFailures(scenario, input, output.tree);
  const outcome =
    output.tree === undefined
      ? 'handed_off'
      : failures.length === 0
        ? 'pass'
        : 'fail';
  const arrangementNotAsked = asksNoArrangement(scenario, input)
    ? {
        changed: output.tree !== undefined && !keepsTree(scenario, output.tree),
      }
    : undefined;
  return {
    outcome,
    failures,
    detail: {
      ...recorded,
      ...(pairCheck && { pairCheck }),
      ...(arrangementNotAsked && { arrangementNotAsked }),
    },
  };
}

function expectsLayoutDeferral(scenario: Scenario): boolean {
  return (
    scenario.expected.status === 'deferred' &&
    scenario.expected.deferStage === 'jevLayout'
  );
}

function withSpatialGate(
  plan: GatedActionPlan,
  spatial: GateAnswer,
): GatedActionPlan {
  return {
    ...plan,
    gates: { ...plan.gates, spatial },
    selection: {
      ...plan.selection,
      ...(plan.selection.gates && {
        gates: { ...plan.selection.gates, spatial },
      }),
    },
  };
}

function asksNoArrangement(
  scenario: Scenario,
  input: GatedActionPlan,
): boolean {
  if (scenario.spatial === true || scenario.expected.status !== 'planned')
    return false;
  const { request } = input.selection.input;
  if (request.layout.type !== 'tiling') return false;
  const visible = visibleInstances(input);
  if (visible === undefined) return false;
  const current = getVisibleInstanceIds(request.layout);
  return (
    current.size === visible.length &&
    visible.every(({ instanceId }) => current.has(instanceId)) &&
    layoutFits(request, request.layout.tree, visible)
  );
}

function keepsTree(scenario: Scenario, tree: readonly TilingNode[]): boolean {
  return checkArrangement([{ kind: 'unchangedTree' }], {
    request: scenario.request,
    tree,
  }).pass;
}

function treeFailures(
  scenario: Scenario,
  input: GatedActionPlan,
  tree: readonly TilingNode[],
): readonly string[] {
  const failures = [...(scoreLayout(scenario, { tree })?.failures ?? [])];
  const visible = visibleInstances(input);
  if (visible === undefined)
    failures.push('Fit: the action plan does not simulate');
  else if (!layoutFits(input.selection.input.request, tree, visible))
    failures.push(
      'Fit: the tree does not place each visible Instance once within the Chart at its minimum size',
    );
  return failures;
}

function visibleInstances(
  plan: GatedActionPlan,
): readonly VesselInstanceSnapshot[] | undefined {
  const retained = plan.selection.instances.filter(
    (instance) => instance.decision !== 'delete',
  );
  const variants = finalVariants(
    retained,
    plan.actions,
    plan.selection.input.request.vessels,
  );
  if (isErr(variants)) return undefined;
  return retained
    .filter((instance) => instance.visible)
    .map((instance) => ({
      instanceId: instance.instanceId,
      vesselId: instance.vesselId,
      variant: variants.value.get(instance.instanceId) ?? instance.variant,
    }));
}

function comparePairs(
  scenario: Scenario,
  record: ComposedPairsRecord,
  tree: readonly TilingNode[] | undefined,
): PairsAnswerCheck | { readonly unavailable: string } {
  const referenceTree = referenceTreeOf(scenario);
  if (referenceTree === undefined)
    return { unavailable: 'the scenario states no reference tree' };
  const { layout } = scenario.request;
  const check = checkPairAnswers(
    record,
    referenceTree,
    layout.type === 'tiling' ? layout.tree : [],
    tree,
  );
  return typeof check === 'string' ? { unavailable: check } : check;
}

/** The scenario's reference tree, or the current tree when the scenario expects it unchanged. */
function referenceTreeOf(
  scenario: Scenario,
): readonly (string | null)[] | undefined {
  if (scenario.expected.tree !== undefined) return scenario.expected.tree;
  const { layout } = scenario.request;
  return scenario.expected.arrangement?.some(
    (rule) => rule.kind === 'unchangedTree',
  ) && layout.type === 'tiling'
    ? layout.tree
    : undefined;
}
