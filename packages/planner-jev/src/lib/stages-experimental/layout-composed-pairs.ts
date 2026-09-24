import type { Stage, StageContext } from '@maelstrom-co/engine';
import {
  type ChartRequest,
  type InstanceId,
  isErr,
  ok,
  type TilingNode,
  tilingLeafInstanceId,
  tilingLeafToken,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import { deferAt } from '../defer.js';
import { finalVariants } from '../final-variants.js';
import { layoutFits } from '../layout-fit.js';
import {
  type Answer,
  type ChoiceQuestion,
  choice,
  intentText,
  isScoreAnswer,
  noul,
  type Question,
  type Reply,
  readAnswer,
  type ScoreAnswer,
  score,
} from '../questions.js';
import type { AnswerRecord } from '../types.js';
import type { Ask } from '../typesafe-client.js';
import {
  type ComposedRoute,
  levelSize,
  type RecordedChoice,
  type RecordedSize,
} from './layout-composed.js';
import {
  comparisonLogRatio,
  FRACTION_LEVELS,
  interpolateLevels,
  logAreaShares,
  partFractionShares,
} from './layout-composed-pairs-sizes.js';
import {
  type Arrangement,
  arrangementTree,
  arrangementTreeAtMinimum,
  equalArrangementTree,
  type MinimumFraction,
  NOT_STATED,
  type PartSizing,
  PROBABILITY_FLOOR,
  rankArrangements,
} from './layout-composed-pairs-tree.js';
import { sizeShares } from './layout-composed-tree.js';
import { describeLayout } from './layout-describe.js';
import type { GatedActionPlan, LayoutDecision } from './types.js';

/** The most visible Instances {@link layoutComposedPairs} enumerates every arrangement of. */
export const MAX_PAIRS_INSTANCES = 6;

/** Why a composed-pairs layout was handed to the completion stage. */
export type PairsHandOff = 'nothing_fits' | 'too_many_instances';

/** How a composed-pairs tree was resized when none of the top candidates fit as sized. */
export type PairsSizeFallback = 'raised_to_minimum' | 'equal_weights';

/**
 * Which questions {@link layoutComposedPairsWithOptions} asks and how it
 * turns the answers into a tree. Every option left out keeps the
 * {@link layoutComposedPairs} behaviour.
 */
export interface ComposedPairsOptions {
  /** The `layoutId` a written tree is returned with. */
  readonly layoutId: string;
  /**
   * Ask the top-level direction question: `scored` adds its log probability
   * to each tree (see {@link layoutComposedPairsWithDirection});
   * `redirects_not_stated` also sends not stated pair answers along the
   * direction's most likely option when that option is side by side or
   * stacked, keeping each pair's order in the current tree;
   * `redirects_not_stated_when_direction_changes` redirects only when that
   * option differs from the current tree's top split, and otherwise lets
   * not stated vote for each pair's current relation.
   */
  readonly direction?:
    | 'scored'
    | 'redirects_not_stated'
    | 'redirects_not_stated_when_direction_changes';
  /**
   * When none of the top trees fits, retry each in rank order keeping its
   * structure: first with every share below its Instance's minimum size
   * raised to it, then with equal weights; hand off only when neither fits.
   */
  readonly sizeFallback?: boolean;
  /** Add whole-board phrases, such as "stack them all" or "in a row", to the side options of every pair question. */
  readonly wholeBoardExamples?: boolean;
  /**
   * Ask per Instance a second size question about its share of the row or
   * column the request groups it with, and split inside each part by those
   * answers. Parts along the top axis keep their whole-Chart shares.
   */
  readonly sizeWithinPart?: boolean;
  /** A part's weight along the top axis: the sum (default) or the largest of its members' shares. */
  readonly partWeight?: 'sum' | 'max';
  /**
   * The share each size level stands for: `even` (default) is 0, 0.25,
   * 0.5, 0.75 and 1; `bigger` is {@link BIGGER_SIZE_STEPS}, where larger is
   * twice an equal share and most is three times.
   */
  readonly sizeSteps?: 'even' | 'bigger';
  /** Send only the request and each Instance's id and widget, without the current arrangement or variants. */
  readonly leanState?: boolean;
  /** How sizes are asked and read; see {@link SizeAnswers}. The picked level of the whole-Chart size question when absent. */
  readonly sizeAnswers?: SizeAnswers;
  /**
   * When the select stage's `spatial` gate lets the stage keep the current
   * tree without a call, given the same visible Instances and a current
   * tree that fits: `answer` (default) on any no; `confident_no` only when
   * the gate's probability of yes is below `below`; `never_skips` never, so
   * two or more visible Instances are always asked about, with not stated
   * voting for the current tree.
   */
  readonly spatialGate?: SpatialGateUse;
  /**
   * What the stage does when no tree fits, after the size fallback when it
   * is on, or when a single visible Instance does not fit: `hands_off`
   * (default) to the completion stage, or `defers` with
   * `jevLayout/no_feasible_layout`, as `layoutPresetOrLlm` does. More than
   * {@link MAX_PAIRS_INSTANCES} visible Instances still hand off.
   */
  readonly nothingFits?: 'hands_off' | 'defers';
}

/** How {@link ComposedPairsOptions.spatialGate} reads the `spatial` gate. */
export type SpatialGateUse =
  | 'answer'
  | 'never_skips'
  | { readonly kind: 'confident_no'; readonly below: number };

/**
 * Other ways {@link layoutComposedPairsWithOptions} asks and reads sizes.
 *
 * - `fractions_within_part`: also asks per Instance whether the request
 *   states its size within the row or column it groups it with (yes/no),
 *   and what fraction of that row or column it gets (a score over
 *   {@link FRACTION_LEVELS}, read by its continuous score interpolated
 *   between the level fractions). Inside each part, stated members get
 *   their fraction and the others split the rest (see
 *   `partFractionShares`): evenly, or with `unstatedSplit:
 *   'whole_chart_shares'` in proportion to their whole-Chart shares. Parts
 *   along the top axis keep the summed whole-Chart shares.
 * - `score_when_confident`: reads each whole-Chart size answer by its
 *   continuous score, interpolated between the level shares, when its
 *   confidence is at least `minimumConfidence`, and by its picked level
 *   otherwise.
 * - `pair_comparisons`: replaces the whole-Chart size question with one
 *   question per pair of visible Instances, how much space the request
 *   gives the first compared with the second (see `COMPARISON_RATIOS`),
 *   solves area shares from the log ratios by least squares (see
 *   `logAreaShares`) and weights the tree by them as by shares. Asks
 *   n(n-1)/2 questions instead of n.
 */
export type SizeAnswers =
  | {
      readonly kind: 'fractions_within_part';
      readonly unstatedSplit?: 'even' | 'whole_chart_shares';
    }
  | {
      readonly kind: 'score_when_confident';
      readonly minimumConfidence: number;
    }
  | { readonly kind: 'pair_comparisons' };

/** Jev's answers about one Instance's fraction of the row or column the request groups it with. */
export interface RecordedGroupFraction {
  /** The probability that the request states a size for the Instance within its row or column. */
  readonly stated: number;
  /** The fraction answer; its `size` is the interpolated fraction. */
  readonly fraction: RecordedSize;
}

/** Jev's answer comparing the space of one pair of visible Instances. */
export interface RecordedComparison {
  readonly first: InstanceId;
  readonly second: InstanceId;
  /** The answer; its `size` is unused and 0. */
  readonly answer: RecordedSize;
  /** The log area ratio, `first` over `second`, the continuous score stands for. */
  readonly logRatio: number;
}

/** The share per size level for {@link ComposedPairsOptions.sizeSteps} `bigger`, smallest level first. */
export const BIGGER_SIZE_STEPS: readonly number[] = [0, 0.25, 0.5, 1, 1.5];

/** Jev's recorded answer about one pair of visible Instances. */
export interface RecordedPair {
  /** The Instance earlier in the visible list; the answer places it relative to {@link second}. */
  readonly first: InstanceId;
  readonly second: InstanceId;
  readonly answer: RecordedChoice;
}

/** One of the top-scored trees, and whether it fit the Chart and every minimum size. */
export interface PairsCandidate {
  readonly tree: readonly TilingNode[];
  /** Sum over the pairs, and the top-level direction when asked, of the log probability the tree implies. */
  readonly score: number;
  readonly fits: boolean;
}

/** What {@link layoutComposedPairs} did, so a wrong layout attributes to a gate case or an answer. */
export interface ComposedPairsRecord {
  readonly route: ComposedRoute;
  /** Whether a Jev call was made. */
  readonly called: boolean;
  /** Absent when no call was made. */
  readonly pairs?: readonly RecordedPair[];
  /** Absent when no call was made, or when size comparisons replaced the size question. */
  readonly sizes?: Readonly<Record<string, RecordedSize>>;
  /** Answers to the size question within each Instance's row or column; present only when that question was asked. */
  readonly groupSizes?: Readonly<Record<string, RecordedSize>>;
  /** Answers about each Instance's fraction of its row or column; present only when that question was asked. */
  readonly groupFractions?: Readonly<Record<string, RecordedGroupFraction>>;
  /** Answers comparing each pair's space; present only when those questions were asked. */
  readonly sizeComparisons?: readonly RecordedComparison[];
  /** Area shares solved from {@link sizeComparisons}. */
  readonly areaShares?: Readonly<Record<string, number>>;
  /** Jev's answer about the top-level split; present only when {@link layoutComposedPairsWithDirection} made a call. */
  readonly direction?: RecordedChoice;
  /** The top-scored trees, best first, each checked with `layoutFits`. */
  readonly candidates: readonly PairsCandidate[];
  /** Index into {@link candidates} of the returned tree, as sized; absent when a size fallback wrote it. */
  readonly chosen?: number;
  /** The size fallback that wrote the returned tree, and the index into {@link candidates} of the structure it kept. */
  readonly fallback?: {
    readonly kind: PairsSizeFallback;
    readonly candidate: number;
  };
  readonly handOff?: PairsHandOff;
  /** The best tree's score minus the second best's; absent when no call was made. */
  readonly margin?: number;
}

/** A layout decision with the composed-pairs record. */
export type ComposedPairsDecision = LayoutDecision & {
  readonly pairwise: ComposedPairsRecord;
};

/**
 * Composes the layout from Jev's answers about pairs, in one call: for
 * every unordered pair of visible Instances, where the request puts one
 * relative to the other (or that it does not say), and per Instance how
 * much of the Chart the request gives it. Every question stands alone, so
 * independent answers cannot contradict a shared shape.
 *
 * Code enumerates every two-level tree of the visible Instances (see
 * `enumerateArrangements`), scores each by the log probability of the
 * relations it implies, with "not stated" voting for the current tree's
 * relation, weights the splits by the chosen size levels, and returns the
 * best of the top three trees that fits (`source: 'jev'`), or hands off
 * (`source: 'llm'`, no tree) when none fits or more than
 * {@link MAX_PAIRS_INSTANCES} Instances are visible.
 *
 * Reads the `spatial` gate like `layoutComposed`: with no stated
 * arrangement and the same visible Instances, the current tree is kept
 * when it fits (`source: 'preserve'`, no call). With at most one visible
 * Instance there is only one tree and no call is made.
 */
export function layoutComposedPairs(
  ask: Ask,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  return composedPairs(ask, { layoutId: 'composed-pairs' });
}

/**
 * {@link layoutComposedPairs} with one more question in the same call:
 * whether the request splits the whole Chart side by side or stacked, or
 * does not say. The answer is a soft score only: each tree also scores
 * the log probability of its top-level direction, weighted as one pair,
 * with "not stated" voting for the current tree's top split. No tree is
 * ruled out by it. Returns `layoutId: 'composed-pairs-with-direction'`.
 */
export function layoutComposedPairsWithDirection(
  ask: Ask,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  return composedPairs(ask, {
    layoutId: 'composed-pairs-with-direction',
    direction: 'scored',
  });
}

/**
 * {@link layoutComposedPairs} with the questions and tree building that
 * `options` selects (see {@link ComposedPairsOptions}), for comparing
 * fixes one at a time and together. Returns `layoutId: options.layoutId`.
 */
export function layoutComposedPairsWithOptions(
  ask: Ask,
  options: ComposedPairsOptions,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  return composedPairs(ask, options);
}

const STAGE = 'jevLayout';

/** How many of the top-scored trees are checked for fit. */
const CANDIDATES = 3;

const SIZE_LEVEL_COUNT = 5;

const DIRECTION_QUESTION = 'direction';

/** The probability of yes at which a size counts as stated within its row or column. */
const STATED_PROBABILITY = 0.5;

function composedPairs(
  ask: Ask,
  options: ComposedPairsOptions,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  const { layoutId } = options;
  const withDirection = options.direction !== undefined;
  const steps =
    options.sizeSteps === 'bigger'
      ? BIGGER_SIZE_STEPS
      : Array.from({ length: SIZE_LEVEL_COUNT }, (_, level) =>
          levelSize(level, SIZE_LEVEL_COUNT),
        );
  return async (plan, ctx) => {
    const { request } = plan.selection.input;
    const retained = plan.selection.instances.filter(
      (instance) => instance.decision !== 'delete',
    );
    const variants = finalVariants(retained, plan.actions, request.vessels);
    if (isErr(variants)) return deferAt(ctx, STAGE, 'simulation_failed');
    const visible: VesselInstanceSnapshot[] = retained
      .filter((instance) => instance.visible)
      .map((instance) => ({
        instanceId: instance.instanceId,
        vesselId: instance.vesselId,
        variant: variants.value.get(instance.instanceId) ?? instance.variant,
      }));

    const currentTree: readonly TilingNode[] =
      request.layout.type === 'tiling' ? request.layout.tree : [];
    const currentIds = new Set(
      currentTree.flatMap((node) => tilingLeafInstanceId(node) ?? []),
    );
    const sameInstances =
      visible.every(({ instanceId }) => currentIds.has(instanceId)) &&
      currentIds.size === visible.length;
    const route: ComposedRoute =
      plan.gates.spatial.answer === 'yes'
        ? 'spatial'
        : sameInstances
          ? 'same_instances'
          : 'instances_changed';
    const record = { route, called: false };

    if (
      route === 'same_instances' &&
      skipsOnSpatialNo(options.spatialGate, plan.gates.spatial.probability) &&
      layoutFits(request, currentTree, visible)
    )
      return ok({
        plan,
        source: 'preserve',
        layoutId: 'preserve',
        tree: currentTree,
        answers: [],
        pairwise: { ...record, candidates: [] },
      });

    if (visible.length <= 1) {
      const tree = visible.map(({ instanceId }) => tilingLeafToken(instanceId));
      const fits = layoutFits(request, tree, visible);
      if (!fits && options.nothingFits === 'defers')
        return deferAt(ctx, STAGE, 'no_feasible_layout', 'layout');
      return ok({
        plan,
        answers: [],
        ...(fits ? { source: 'jev', layoutId, tree } : { source: 'llm' }),
        pairwise: {
          ...record,
          candidates: [],
          ...(!fits && { handOff: 'nothing_fits' }),
        },
      });
    }

    if (visible.length > MAX_PAIRS_INSTANCES)
      return ok({
        plan,
        source: 'llm',
        answers: [],
        pairwise: { ...record, candidates: [], handOff: 'too_many_instances' },
      });

    const ids = visible.map(({ instanceId }) => instanceId);
    const pairs = pairsOf(ids);
    const reply = await ask(
      STAGE,
      {
        state: options.leanState
          ? {
              request: intentText(request),
              instances: visible.map((instance) => ({
                id: instance.instanceId,
                widget: instance.vesselId,
              })),
            }
          : {
              request: intentText(request),
              currentArrangement: describeLayout(currentTree),
              instances: visible.map((instance) => ({
                id: instance.instanceId,
                widget: instance.vesselId,
                variant: instance.variant,
              })),
            },
        questions: {
          ...questions(visible, pairs, options),
          ...(withDirection && { [DIRECTION_QUESTION]: directionQuestion() }),
        },
      },
      ctx,
    );
    if (isErr(reply)) return reply;
    const read = readAll(reply.value, ids, pairs, ctx, steps, options);
    if (isErr(read)) return read;
    const {
      pairAnswers,
      sizes,
      groupSizes,
      groupFractions,
      sizeComparisons,
      records,
    } = read.value;
    let direction: RecordedChoice | undefined;
    if (withDirection) {
      const answer = readAnswer(reply.value, DIRECTION_QUESTION, STAGE, ctx);
      if (isErr(answer)) return answer;
      records.push(answerRecord(DIRECTION_QUESTION, answer.value));
      direction = recordedChoice(answer.value);
    }

    const ranked = rankArrangements(
      ids,
      pairAnswers.map(({ first, second, answer }) => ({
        first,
        second,
        probabilities: answer.probabilities,
      })),
      currentTree,
      direction?.probabilities,
      {
        redirectNotStated:
          options.direction === 'redirects_not_stated' ||
          options.direction === 'redirects_not_stated_when_direction_changes',
        redirectOnlyWhenDirectionChanges:
          options.direction === 'redirects_not_stated_when_direction_changes',
      },
    );
    const areaShares =
      sizeComparisons &&
      logAreaShares(
        ids,
        sizeComparisons.map(({ first, second, logRatio }) => ({
          first,
          second,
          logRatio,
        })),
      );
    const shareById = areaShares ?? sharesById(ids, sizes ?? {});
    const unstatedByWholeChart =
      options.sizeAnswers?.kind === 'fractions_within_part' &&
      options.sizeAnswers.unstatedSplit === 'whole_chart_shares';
    const sizing: PartSizing = {
      ...(options.partWeight && { partWeight: options.partWeight }),
      ...(groupSizes && { innerShareById: sharesById(ids, groupSizes) }),
      ...(groupFractions && {
        innerSharesOf: (members: readonly InstanceId[]) =>
          partFractionShares(
            members.map((id) => {
              const answer = groupFractions[id];
              return answer && answer.stated >= STATED_PROBABILITY
                ? answer.fraction.size
                : undefined;
            }),
            unstatedByWholeChart
              ? members.map((id) => shareById[id] ?? 0)
              : undefined,
          ),
      }),
    };
    const top = ranked.slice(0, CANDIDATES);
    const candidates = top.map(({ arrangement, score }) => {
      const tree = arrangementTree(arrangement, shareById, sizing);
      return { tree, score, fits: layoutFits(request, tree, visible) };
    });
    const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
    const called = {
      ...record,
      called: true,
      pairs: pairAnswers,
      ...(sizes && { sizes }),
      ...(groupSizes && { groupSizes }),
      ...(groupFractions && { groupFractions }),
      ...(sizeComparisons && { sizeComparisons, areaShares }),
      ...(direction && { direction }),
      candidates,
      margin,
    };
    const chosen = candidates.findIndex((candidate) => candidate.fits);
    const tree = candidates[chosen]?.tree;
    if (tree === undefined && options.sizeFallback) {
      const resized = sizeFallback(
        top.map(({ arrangement }) => arrangement),
        (arrangement) =>
          arrangementTreeAtMinimum(
            arrangement,
            shareById,
            minimumFractions(request, visible),
            sizing,
          ),
        (candidate) => layoutFits(request, candidate, visible),
      );
      if (resized)
        return ok({
          plan,
          source: 'jev',
          layoutId,
          tree: resized.tree,
          answers: records,
          pairwise: { ...called, fallback: resized.fallback },
        });
    }
    if (tree === undefined && options.nothingFits === 'defers')
      return deferAt(ctx, STAGE, 'no_feasible_layout', 'layout');
    if (tree === undefined)
      return ok({
        plan,
        source: 'llm',
        answers: records,
        pairwise: { ...called, handOff: 'nothing_fits' },
      });
    return ok({
      plan,
      source: 'jev',
      layoutId,
      tree,
      answers: records,
      pairwise: { ...called, chosen },
    });
  };
}

function skipsOnSpatialNo(
  use: SpatialGateUse | undefined,
  probability: number,
): boolean {
  if (use === undefined || use === 'answer') return true;
  if (use === 'never_skips') return false;
  return probability < use.below;
}

function sharesById(
  ids: readonly InstanceId[],
  sizes: Readonly<Record<string, RecordedSize>>,
): Record<string, number> {
  const shares = sizeShares(ids.map((id) => sizes[id]?.size ?? 0));
  return Object.fromEntries(ids.map((id, index) => [id, shares[index] ?? 0]));
}

function sizeFallback(
  arrangements: readonly Arrangement[],
  atMinimum: (arrangement: Arrangement) => readonly TilingNode[] | undefined,
  fits: (tree: readonly TilingNode[]) => boolean,
):
  | {
      readonly tree: readonly TilingNode[];
      readonly fallback: NonNullable<ComposedPairsRecord['fallback']>;
    }
  | undefined {
  for (const [candidate, arrangement] of arrangements.entries()) {
    const raised = atMinimum(arrangement);
    if (raised && fits(raised))
      return {
        tree: raised,
        fallback: { kind: 'raised_to_minimum', candidate },
      };
    const equal = equalArrangementTree(arrangement);
    if (fits(equal))
      return { tree: equal, fallback: { kind: 'equal_weights', candidate } };
  }
  return undefined;
}

function minimumFractions(
  request: ChartRequest,
  visible: readonly VesselInstanceSnapshot[],
): Record<string, MinimumFraction> {
  const { columns, rows } = request.context.chartDimensions;
  return Object.fromEntries(
    visible.map(({ instanceId, vesselId, variant }) => {
      const minimum = request.vessels.find((vessel) => vessel.id === vesselId)
        ?.variants[variant]?.minSize;
      return [
        instanceId,
        {
          width: (minimum?.width ?? 0) / columns,
          height: (minimum?.height ?? 0) / rows,
        },
      ];
    }),
  );
}

const SIZE_LEVELS = [
  "as small as it can be: the `request` asks to shrink it to the minimum, signals: 'tiny', 'minimize it', 'as small as possible', 'just a sliver'",
  "smaller than an equal share: signals: 'narrow', 'smaller', 'a thin column', 'a sidebar', 'a third', the rest when another widget gets 'two thirds' or 'most of the board'",
  "an equal share: the `request` gives it no size, or asks for equal sizes, signals: 'equal', 'same size', 'evenly', 'split evenly'",
  "larger than an equal share: signals: 'bigger', 'wider', 'taller', 'larger', 'half the board' when there are three or more widgets",
  "most of the chart: signals: 'two thirds', 'most of the board', 'the main widget', 'make it big', 'give it the most room'",
];

const GROUP_SIZE_LEVELS = [
  "as small as it can be within its row or column: signals: 'tiny', 'minimize it', 'as small as possible', 'just a sliver'",
  "smaller than the others in its row or column: signals: 'narrow', 'smaller', 'shorter', 'a thin strip', 'a third of the column', the rest when another widget in the row or column gets 'two thirds' or 'most of it'",
  "an equal share of its row or column: the `request` gives it no size there, or asks for equal sizes, or puts it in no row or column with other widgets, signals: 'equal', 'same size', 'evenly'",
  "larger than the others in its row or column: signals: 'bigger', 'taller', 'wider', 'half the column', 'half the height', 'half of the row' when the row or column has three or more widgets",
  "most of its row or column: signals: 'two thirds of the column', 'most of the row', 'give it most of the height'",
];

interface NamedInstance {
  readonly id: InstanceId;
  readonly widget: string;
}

function pairsOf(
  ids: readonly InstanceId[],
): readonly (readonly [InstanceId, InstanceId])[] {
  return ids.flatMap((first, index) =>
    ids.slice(index + 1).map((second) => [first, second] as const),
  );
}

function pairQuestionId(first: InstanceId, second: InstanceId): string {
  return `pair/${first}/${second}`;
}

function sizeQuestionId(id: InstanceId): string {
  return `size/${id}`;
}

function groupSizeQuestionId(id: InstanceId): string {
  return `size_in_group/${id}`;
}

function statedInGroupQuestionId(id: InstanceId): string {
  return `size_stated_in_group/${id}`;
}

function fractionInGroupQuestionId(id: InstanceId): string {
  return `fraction_in_group/${id}`;
}

function comparisonQuestionId(first: InstanceId, second: InstanceId): string {
  return `size_comparison/${first}/${second}`;
}

const FRACTION_TEXTS = [
  "a quarter of its row or column or less: signals: 'a quarter', 'a thin strip of the column', 'just a sliver'",
  "a third of its row or column: signals: 'a third', 'one of three equal rows', 'the rest when another widget gets two thirds'",
  "half of its row or column: signals: 'half', 'half the height', 'half the column', 'half of the row', 'one of two equal parts'",
  "two thirds of its row or column: signals: 'two thirds', 'twice the others' when it shares with one other widget",
  "three quarters of its row or column or more: signals: 'three quarters', 'most of the column', 'nearly all of the row'",
];

const COMPARISON_TEXTS = [
  'a quarter of the space of the other widget or less',
  'about half the space of the other widget',
  'about the same space as the other widget, or the `request` states no size difference between them',
  'about twice the space of the other widget',
  'four times the space of the other widget or more',
];

function comparisonQuestion(a: NamedInstance, b: NamedInstance) {
  return score(
    `How much space on the chart does the \`request\` give ${a.id} (the ${a.widget} widget) compared with ${b.id} (the ${b.widget} widget)? Compare the areas the two widgets take. Answer from the \`request\` alone.`,
    COMPARISON_TEXTS,
  );
}

function questions(
  visible: readonly VesselInstanceSnapshot[],
  pairs: readonly (readonly [InstanceId, InstanceId])[],
  options: ComposedPairsOptions,
): Record<string, Question> {
  const named = new Map(
    visible.map(({ instanceId, vesselId }) => [
      instanceId,
      { id: instanceId, widget: vesselId },
    ]),
  );
  const nameOf = (id: InstanceId): NamedInstance =>
    named.get(id) ?? { id, widget: id };
  return {
    ...Object.fromEntries(
      pairs.map(([first, second]) => [
        pairQuestionId(first, second),
        pairQuestion(
          nameOf(first),
          nameOf(second),
          options.wholeBoardExamples ?? false,
        ),
      ]),
    ),
    ...(options.sizeAnswers?.kind !== 'pair_comparisons' &&
      Object.fromEntries(
        visible.map(({ instanceId, vesselId }) => [
          sizeQuestionId(instanceId),
          score(
            `How much of the chart does the \`request\` give ${instanceId} (the ${vesselId} widget)? Answer from the \`request\` alone.`,
            SIZE_LEVELS,
          ),
        ]),
      )),
    ...(options.sizeAnswers?.kind === 'fractions_within_part' &&
      Object.fromEntries(
        visible.flatMap(({ instanceId, vesselId }) => [
          [
            statedInGroupQuestionId(instanceId),
            noul(
              `Does the \`request\` state how much of its row or column ${instanceId} (the ${vesselId} widget) takes, compared with the other widgets in that row or column, such as 'half the height', 'a third of the column', 'two thirds of the row' or 'most of the right column'? Answer no when the \`request\` states no size for ${instanceId}, or only a size of the whole chart such as 'two thirds of the board' or 'a narrow column'. Answer from the \`request\` alone.`,
            ),
          ],
          [
            fractionInGroupQuestionId(instanceId),
            score(
              `The \`request\` may put ${instanceId} (the ${vesselId} widget) in a row or a column together with other widgets. What fraction of that row or column does the \`request\` give ${instanceId}? Answer from the \`request\` alone.`,
              FRACTION_TEXTS,
            ),
          ],
        ]),
      )),
    ...(options.sizeAnswers?.kind === 'pair_comparisons' &&
      Object.fromEntries(
        pairs.map(([first, second]) => [
          comparisonQuestionId(first, second),
          comparisonQuestion(nameOf(first), nameOf(second)),
        ]),
      )),
    ...(options.sizeWithinPart &&
      Object.fromEntries(
        visible.map(({ instanceId, vesselId }) => [
          groupSizeQuestionId(instanceId),
          score(
            `The \`request\` may put ${instanceId} (the ${vesselId} widget) in a row or a column together with other widgets. How much of that row or column does the \`request\` give ${instanceId}, compared with the widgets it shares it with? Answer from the \`request\` alone.`,
            GROUP_SIZE_LEVELS,
          ),
        ]),
      )),
  };
}

const STACK_PHRASES = [
  'stack them all',
  'in one column',
  'in a column',
  'one on top of the other',
];

const ROW_PHRASES = ['in a row', 'all side by side'];

function pairQuestion(
  a: NamedInstance,
  b: NamedInstance,
  wholeBoardExamples: boolean,
): ChoiceQuestion {
  const one = `${a.id} (the ${a.widget} widget)`;
  const other = `${b.id} (the ${b.widget} widget)`;
  const stack = wholeBoardExamples ? STACK_PHRASES : [];
  const row = wholeBoardExamples ? ROW_PHRASES : [];
  return choice(
    `Where does the \`request\` put ${one} relative to ${other}? Choose a side only when the \`request\` states it or directly implies it for these two widgets.`,
    {
      left_of: {
        what: `${a.id} is to the left of ${b.id}`,
        not_for: `${a.id} above, below or to the right of ${b.id}`,
        examples: [
          `${a.widget} left of ${b.widget}`,
          `${a.widget} before ${b.widget} in the row`,
          `${a.widget} next to ${b.widget} on the left`,
          `${a.widget} on the left, ${b.widget} on the right`,
          ...row,
        ],
      },
      right_of: {
        what: `${a.id} is to the right of ${b.id}`,
        not_for: `${a.id} above, below or to the left of ${b.id}`,
        examples: [
          `${a.widget} right of ${b.widget}`,
          `${a.widget} after ${b.widget} in the row`,
          `${a.widget} next to ${b.widget} on the right`,
          `${b.widget} on the left, ${a.widget} on the right`,
          ...row,
        ],
      },
      above: {
        what: `${a.id} is above ${b.id}`,
        not_for: `${a.id} beside ${b.id} in the same row, or below it`,
        examples: [
          `${a.widget} above ${b.widget}`,
          `${a.widget} on top of ${b.widget}`,
          `${a.widget} over ${b.widget}`,
          `${a.widget} stacked on ${b.widget}`,
          `${a.widget} at the top, ${b.widget} at the bottom`,
          ...stack,
        ],
      },
      below: {
        what: `${a.id} is below ${b.id}`,
        not_for: `${a.id} beside ${b.id} in the same row, or above it`,
        examples: [
          `${a.widget} below ${b.widget}`,
          `${a.widget} under ${b.widget}`,
          `${b.widget} on top of ${a.widget}`,
          `${b.widget} stacked on ${a.widget}`,
          `${b.widget} at the top, ${a.widget} at the bottom`,
          ...stack,
        ],
      },
      [NOT_STATED]: {
        what: `The \`request\` says nothing that places ${a.id} relative to ${b.id}`,
        not_for: `a \`request\` that names a side or an order for ${a.widget} against ${b.widget}`,
        examples: [
          `make the ${a.widget} bigger`,
          `add a map`,
          'show my week',
          'a request about other widgets only',
        ],
      },
    },
  );
}

function directionQuestion(): ChoiceQuestion {
  return choice(
    'How does the `request` split the whole chart: are all the widgets, or groups of them, side by side from left to right, or stacked from top to bottom? Choose one only when the `request` states it or directly implies it for the chart as a whole.',
    {
      side_by_side: {
        what: 'The `request` puts the widgets, or groups of widgets, side by side across the chart, from left to right',
        not_for: 'a `request` that stacks the widgets from top to bottom',
        examples: [
          'put them all side by side',
          'in a row',
          'line them up left to right',
          'next to each other',
          'the calendar on the left, the rest on the right',
        ],
      },
      stacked: {
        what: 'The `request` stacks the widgets, or groups of widgets, from top to bottom of the chart',
        not_for:
          'a `request` that puts the widgets side by side from left to right',
        examples: [
          'stack them all',
          'in one column',
          'one on top of the other',
          'top to bottom',
          'the calendar at the top, the rest below',
        ],
      },
      [NOT_STATED]: {
        what: 'The `request` says nothing about how the whole chart is split',
        not_for:
          'a `request` that puts the widgets side by side or stacks them',
        examples: [
          'make the calendar bigger',
          'add a map',
          'show my week',
          'a request about one widget only',
        ],
      },
    },
  );
}

function readAll(
  reply: Reply,
  ids: readonly InstanceId[],
  pairs: readonly (readonly [InstanceId, InstanceId])[],
  ctx: StageContext,
  steps: readonly number[],
  options: ComposedPairsOptions,
) {
  const records: AnswerRecord[] = [];
  const pairAnswers: RecordedPair[] = [];
  for (const [first, second] of pairs) {
    const question = pairQuestionId(first, second);
    const answer = readAnswer(reply, question, STAGE, ctx);
    if (isErr(answer)) return answer;
    records.push(answerRecord(question, answer.value));
    pairAnswers.push({ first, second, answer: recordedChoice(answer.value) });
  }
  const sizeAnswers = options.sizeAnswers;
  const readScore = (question: string) => {
    const answer = readAnswer(reply, question, STAGE, ctx);
    if (isErr(answer)) return answer;
    if (!isScoreAnswer(answer.value))
      return deferAt(ctx, STAGE, 'answer_missing', question);
    records.push(answerRecord(question, answer.value));
    return ok(answer.value);
  };
  const levelStep = (answer: ScoreAnswer) => steps[Number(answer.choice)] ?? 0;
  const sizeOf = (answer: ScoreAnswer) =>
    sizeAnswers?.kind === 'score_when_confident' &&
    answer.confidence >= sizeAnswers.minimumConfidence
      ? interpolateLevels(answer.score, steps)
      : levelStep(answer);
  const sizes: Record<string, RecordedSize> = {};
  const groupSizes: Record<string, RecordedSize> = {};
  const sizeQuestions = [
    ...(sizeAnswers?.kind === 'pair_comparisons'
      ? []
      : [{ target: sizes, questionOf: sizeQuestionId, size: sizeOf }]),
    ...(options.sizeWithinPart
      ? [
          {
            target: groupSizes,
            questionOf: groupSizeQuestionId,
            size: levelStep,
          },
        ]
      : []),
  ];
  for (const { target, questionOf, size } of sizeQuestions)
    for (const id of ids) {
      const answer = readScore(questionOf(id));
      if (isErr(answer)) return answer;
      target[id] = recordedSize(answer.value, size(answer.value));
    }
  const groupFractions: Record<string, RecordedGroupFraction> = {};
  if (sizeAnswers?.kind === 'fractions_within_part')
    for (const id of ids) {
      const statedQuestion = statedInGroupQuestionId(id);
      const stated = readAnswer(reply, statedQuestion, STAGE, ctx);
      if (isErr(stated)) return stated;
      if (stated.value.probability === undefined)
        return deferAt(ctx, STAGE, 'answer_missing', statedQuestion);
      records.push(answerRecord(statedQuestion, stated.value));
      const fraction = readScore(fractionInGroupQuestionId(id));
      if (isErr(fraction)) return fraction;
      groupFractions[id] = {
        stated: stated.value.probability,
        fraction: recordedSize(
          fraction.value,
          interpolateLevels(fraction.value.score, FRACTION_LEVELS),
        ),
      };
    }
  const sizeComparisons: RecordedComparison[] = [];
  if (sizeAnswers?.kind === 'pair_comparisons')
    for (const [first, second] of pairs) {
      const answer = readScore(comparisonQuestionId(first, second));
      if (isErr(answer)) return answer;
      sizeComparisons.push({
        first,
        second,
        answer: recordedSize(answer.value, 0),
        logRatio: comparisonLogRatio(answer.value.score),
      });
    }
  return ok({
    pairAnswers,
    ...(sizeAnswers?.kind !== 'pair_comparisons' && { sizes }),
    ...(options.sizeWithinPart && { groupSizes }),
    ...(sizeAnswers?.kind === 'fractions_within_part' && { groupFractions }),
    ...(sizeAnswers?.kind === 'pair_comparisons' && { sizeComparisons }),
    records,
  });
}

function recordedSize(answer: ScoreAnswer, size: number): RecordedSize {
  return {
    level: answer.choice,
    score: answer.score,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    size,
  };
}

function answerRecord(question: string, answer: Answer): AnswerRecord {
  return {
    stage: STAGE,
    question,
    choice: answer.choice,
    confidence: answer.confidence,
  };
}

function recordedChoice(answer: Answer): RecordedChoice {
  return {
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities ?? {
      [answer.choice]: Math.max(answer.confidence, PROBABILITY_FLOOR),
    },
  };
}
