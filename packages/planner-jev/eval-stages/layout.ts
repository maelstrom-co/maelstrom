import type { Stage } from '@maelstrom-co/engine';
import {
  isErr,
  type TilingNode,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import type { Scenario } from '../eval/scenarios.js';
import { scoreLayout } from '../eval/score.js';
import { finalVariants } from '../src/lib/final-variants.js';
import { layoutFits } from '../src/lib/layout-fit.js';
import { layoutAlwaysLlm } from '../src/lib/stages-experimental/layout-always-llm.js';
import {
  type ComposedLayoutRecord,
  layoutComposed,
} from '../src/lib/stages-experimental/layout-composed.js';
import {
  type ComposedPairsRecord,
  layoutComposedPairs,
  layoutComposedPairsWithDirection,
  layoutComposedPairsWithOptions,
} from '../src/lib/stages-experimental/layout-composed-pairs.js';
import { layoutPreset } from '../src/lib/stages-experimental/layout-preset.js';
import { layoutPresetOrLlm } from '../src/lib/stages-experimental/layout-preset-or-llm.js';
import { layoutSpatialGate } from '../src/lib/stages-experimental/layout-spatial-gate.js';
import type {
  GatedActionPlan,
  LayoutDecision,
  LayoutSource,
} from '../src/lib/stages-experimental/types.js';
import type { AnswerRecord } from '../src/lib/types.js';
import type { Ask } from '../src/lib/typesafe-client.js';
import {
  type ComposedAnswerCheck,
  type ComposedQuestion,
  checkComposedAnswers,
  firstWrongQuestion,
} from './composed-attribution.js';
import { goldInputs } from './gold-inputs.js';
import { layoutComposedScoreSized } from './layout-composed-score-sized.js';
import {
  renderComposedPairsSection,
  renderComposedSection,
} from './layout-report.js';
import {
  checkPairAnswers,
  type PairsAnswerCheck,
} from './pairs-attribution.js';
import type { Judgement, StageEvalModule } from './stage-eval.js';

/** A layout decision as some stages return it, with the composed stages' records. */
export type LayoutOutput = LayoutDecision & {
  readonly composition?: ComposedLayoutRecord;
  readonly pairwise?: ComposedPairsRecord;
};

/**
 * Why a composed turn missed, against the scenario's reference tree: the
 * first question kind answered wrong (`size` by elimination), `no_call`
 * when the stage kept or wrote a tree without asking Jev, or `undefined`
 * when the reference tree cannot be compared (see `reason`).
 */
export interface ComposedMiss {
  readonly question?: ComposedQuestion | 'no_call';
  readonly reason?: string;
}

/** What the layout stage eval records of one decision. */
export interface LayoutTurnDetail {
  readonly source: LayoutSource;
  readonly layoutId?: string;
  /** Absent when the decision handed the layout off. */
  readonly tree?: readonly TilingNode[];
  readonly answers: readonly AnswerRecord[];
  /** `layoutComposed` only. */
  readonly composition?: ComposedLayoutRecord;
  /** `layoutComposed` calls only: every answer against the scenario's reference tree, or why it cannot be compared. */
  readonly answerCheck?: ComposedAnswerCheck | { readonly unavailable: string };
  /** `layoutComposed` turns that did not pass only. */
  readonly miss?: ComposedMiss;
  /** `layoutComposedPairs` and `layoutComposedPairsWithDirection` only. */
  readonly pairwise?: ComposedPairsRecord;
  /** `layoutComposedPairs` calls only: every pair against the scenario's reference tree, or why it cannot be compared. */
  readonly pairCheck?: PairsAnswerCheck | { readonly unavailable: string };
}

type LayoutVariant = (ask: Ask) => Stage<GatedActionPlan, LayoutOutput>;

const COMBINED = {
  direction: 'redirects_not_stated',
  sizeFallback: true,
  wholeBoardExamples: true,
} as const;

// Chosen from the composed-pairs-combined development records before any
// run of the variant: the lowest confidence, in steps of 0.05, at and above
// which every size answer's score lies within a quarter level of its
// picked level (0.75 lets one stray 0.28 levels).
const SIZE_SCORE_MINIMUM_CONFIDENCE = 0.8;

/**
 * Layout stage variants by descriptive name, each built as the matching
 * arm in `eval/arms.ts` builds it; the `composed-pairs` variants have no
 * planner arm. Each `composed-pairs-` fix changes one thing from
 * `composed-pairs` (the redirect builds on `composed-pairs-with-direction`),
 * see `ComposedPairsOptions`. `composed-pairs-combined` stacks the fixes
 * that passed the development stage eval: the direction redirect, the size
 * fallback and the whole-board examples. `composed-pairs-fraction-sizes`,
 * `composed-pairs-score-when-confident` and `composed-pairs-size-comparisons`
 * each change how `composed-pairs-combined` asks or reads sizes, see
 * `SizeAnswers`. `composed-pairs-combined-limited-redirect` redirects not
 * stated only when the direction answer changes the top split;
 * `composed-pairs-fraction-sizes-proportional-fallback` splits what stated
 * fractions leave by whole-Chart shares; `composed-pairs-fraction-sizes-both-fixes`
 * does both.
 */
export const LAYOUT_VARIANTS: Readonly<Record<string, LayoutVariant>> = {
  preset: (ask) => layoutPreset(ask, { describe: 'placements' }),
  'preset-or-llm': layoutPresetOrLlm,
  'spatial-gate': () => layoutSpatialGate(),
  composed: (ask) => layoutComposed(ask),
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
  'composed-pairs-size-within-part': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      layoutId: 'composed-pairs-size-within-part',
      sizeWithinPart: true,
    }),
  'composed-pairs-part-size-max': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      layoutId: 'composed-pairs-part-size-max',
      partWeight: 'max',
    }),
  'composed-pairs-bigger-size-steps': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      layoutId: 'composed-pairs-bigger-size-steps',
      sizeSteps: 'bigger',
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
      ...COMBINED,
      layoutId: 'composed-pairs-fraction-sizes-both-fixes',
      direction: 'redirects_not_stated_when_direction_changes',
      sizeAnswers: {
        kind: 'fractions_within_part',
        unstatedSplit: 'whole_chart_shares',
      },
    }),
  'composed-pairs-score-when-confident': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMBINED,
      layoutId: 'composed-pairs-score-when-confident',
      sizeAnswers: {
        kind: 'score_when_confident',
        minimumConfidence: SIZE_SCORE_MINIMUM_CONFIDENCE,
      },
    }),
  'composed-pairs-size-comparisons': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      ...COMBINED,
      layoutId: 'composed-pairs-size-comparisons',
      sizeAnswers: { kind: 'pair_comparisons' },
    }),
  'composed-pairs-lean-state': (ask) =>
    layoutComposedPairsWithOptions(ask, {
      layoutId: 'composed-pairs-lean-state',
      leanState: true,
    }),
  'composed-2-size-levels': (ask) => layoutComposed(ask, { sizeLevels: 2 }),
  'composed-score-sized': (ask) => layoutComposedScoreSized(ask),
  'composed-2-size-levels-score-sized': (ask) =>
    layoutComposedScoreSized(ask, { sizeLevels: 2 }),
  'always-llm': () => layoutAlwaysLlm(),
};

/**
 * The layout stage on gold inputs: each scenario's expected selection and
 * action plan with every gate (see `goldInputs`). A decision with a tree
 * passes when the tree's leaves are the expected visible set, the
 * arrangement rules hold and the tree fits the Chart and every minimum
 * size; a decision without a tree is handed off.
 */
export const layoutStageEval: StageEvalModule<
  GatedActionPlan,
  LayoutOutput,
  LayoutTurnDetail
> = {
  stage: 'jevLayout',
  variants: LAYOUT_VARIANTS,
  prepare: async (scenario, ctx) => {
    const gold = goldInputs(scenario, 'gated');
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
  judge: judgeLayout,
  reportSections: (records, variants) =>
    [
      renderComposedSection(records, variants),
      renderComposedPairsSection(records, variants),
    ].flatMap((section) => section ?? []),
};

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
    ...(output.composition && { composition: output.composition }),
    ...(output.pairwise && { pairwise: output.pairwise }),
  };
  const pairCheck = output.pairwise?.called
    ? comparePairs(scenario, output.pairwise, output.tree)
    : undefined;
  const answerCheck = output.composition?.answers
    ? compareAnswers(scenario, output.composition)
    : undefined;
  const failures =
    output.tree === undefined ? [] : treeFailures(scenario, input, output.tree);
  const outcome =
    output.tree === undefined
      ? 'handed_off'
      : failures.length === 0
        ? 'pass'
        : 'fail';
  const miss =
    output.composition && outcome !== 'pass'
      ? missOf(output.composition, answerCheck)
      : undefined;
  return {
    outcome,
    failures,
    detail: {
      ...recorded,
      ...(answerCheck && { answerCheck }),
      ...(miss && { miss }),
      ...(pairCheck && { pairCheck }),
    },
  };
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

function compareAnswers(
  scenario: Scenario,
  composition: ComposedLayoutRecord,
): ComposedAnswerCheck | { readonly unavailable: string } {
  const referenceTree = referenceTreeOf(scenario);
  if (referenceTree === undefined)
    return { unavailable: 'the scenario states no reference tree' };
  if (composition.answers === undefined)
    return { unavailable: 'no Jev call was made' };
  const check = checkComposedAnswers(composition.answers, referenceTree);
  return typeof check === 'string' ? { unavailable: check } : check;
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

function missOf(
  composition: ComposedLayoutRecord,
  answerCheck: LayoutTurnDetail['answerCheck'],
): ComposedMiss {
  if (!composition.called) return { question: 'no_call' };
  if (answerCheck === undefined || 'unavailable' in answerCheck)
    return { reason: answerCheck?.unavailable ?? 'no answers were recorded' };
  return { question: firstWrongQuestion(answerCheck) };
}
