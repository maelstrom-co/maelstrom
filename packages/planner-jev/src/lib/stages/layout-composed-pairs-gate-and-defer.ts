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
  FRACTION_LEVELS,
  interpolateLevels,
  partFractionShares,
} from './layout-composed-pairs-sizes.js';
import {
  arrangementTree,
  arrangementTreeAtMinimum,
  equalArrangementTree,
  type MinimumFraction,
  NOT_STATED,
  type OptionProbabilities,
  type PartSizing,
  PROBABILITY_FLOOR,
  pickSizedTree,
  rankArrangements,
  type SizeFallbackKind,
  sizeShares,
} from './layout-composed-pairs-tree.js';
import { describeLayout, describeLayoutChange } from './layout-describe.js';
import type { GatedActionPlan, LayoutDecision } from './stage-types.js';

/** The most visible Instances {@link layoutComposedPairsGateAndDefer} enumerates every arrangement of. */
export const MAX_PAIRS_INSTANCES = 6;

/** The `layoutId` a tree written by {@link layoutComposedPairsGateAndDefer} carries. */
export const COMPOSED_PAIRS_GATE_AND_DEFER_LAYOUT_ID =
  'composed-pairs-gate-and-defer-combined';

/**
 * Which case the select stage's gate and the visible Instances make:
 * `spatial` when the request states an arrangement, `same_instances` when
 * it does not and the visible Instances are the current tree's,
 * `instances_changed` when it does not and Instances were added or
 * removed. Recorded only; every case asks the same questions.
 */
export type ComposedRoute = 'spatial' | 'same_instances' | 'instances_changed';

/** A recorded choice answer with every option's probability. */
export interface RecordedChoice {
  readonly choice: string;
  readonly confidence: number;
  /** Every option's probability; only the chosen option's when the reply carried no distribution. */
  readonly probabilities: OptionProbabilities;
}

/** A recorded size answer. */
export interface RecordedSize {
  /** The most probable level, as a level number string. */
  readonly level: string;
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: OptionProbabilities;
  /**
   * The size the answer stands for, up to 1, before normalising across
   * Instances: the chosen level's share for a whole-Chart size, so
   * Instances given the same level get equal shares, and the interpolated
   * fraction for a fraction of a row or column.
   */
  readonly size: number;
}

/** Why a composed-pairs layout was handed to the completion stage. */
export type PairsHandOff = 'too_many_instances';

/** How a composed-pairs tree was resized because the candidate it kept did not fit as sized. */
export type PairsSizeFallback = SizeFallbackKind;

/** Jev's answers about one Instance's fraction of the row or column the request groups it with. */
export interface RecordedGroupFraction {
  /** The probability that the request states a size for the Instance within its row or column. */
  readonly stated: number;
  /** The fraction answer; its `size` is the interpolated fraction. */
  readonly fraction: RecordedSize;
}

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
  /** Sum over the pairs and the top-level direction of the log probability the tree implies. */
  readonly score: number;
  readonly fits: boolean;
}

/** What {@link layoutComposedPairsGateAndDefer} did, so a wrong layout attributes to a gate case or an answer. */
export interface ComposedPairsRecord {
  readonly route: ComposedRoute;
  /** Whether a Jev call was made. */
  readonly called: boolean;
  /** Absent when no call was made. */
  readonly pairs?: readonly RecordedPair[];
  /** Absent when no call was made. */
  readonly sizes?: Readonly<Record<string, RecordedSize>>;
  /** Answers about each Instance's fraction of its row or column; absent when no call was made. */
  readonly groupFractions?: Readonly<Record<string, RecordedGroupFraction>>;
  /** Jev's answer about the top-level split; absent when no call was made. */
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
 * Composes the layout from Jev's answers about pairs, in one call whenever
 * two or more Instances are visible, whatever the `spatial` gate answered.
 * For every unordered pair of visible Instances the call asks where the
 * request puts one relative to the other (or that it does not say, with
 * whole-board phrases such as "stack them all" among the side options);
 * per Instance how much of the Chart the request gives it, whether the
 * request states its size within its row or column and what fraction of
 * that row or column it gets; and whether the request splits the whole
 * Chart side by side or stacked. Every question stands alone, so
 * independent answers cannot contradict a shared shape.
 *
 * Code enumerates every two-level tree of the visible Instances (see
 * `enumerateArrangements`) and scores each by the log probability of the
 * relations and the top-level direction it implies (see
 * `rankArrangements`): "not stated" votes for the current tree's relation,
 * or, when the direction answer changes the current top split, for the
 * relation along that direction in the current order. Splits along the top
 * axis are weighted by the whole-Chart size answers; inside a row or
 * column, members with a stated fraction get it and the others split the
 * rest by their whole-Chart shares (see `partFractionShares`). The top
 * three trees are tried in rank order (see `pickSizedTree`): a tree that
 * fits as sized is returned (`source: 'jev'`); one that does not gives way
 * to a lower tree of the three that fits as sized and scores within
 * `AS_SIZED_SCORE_MARGIN` of it, and otherwise is returned with every
 * share below its Instance's minimum raised to it, or else with equal
 * weights, before the next tree is tried. So a far worse tree never ships
 * just because it fits without resizing. When nothing fits, or a single
 * visible Instance does not fit, the stage defers
 * with `jevLayout/no_feasible_layout` so the fallback planner answers the
 * turn. More than {@link MAX_PAIRS_INSTANCES} visible Instances hand the
 * layout to the completion stage (`source: 'llm'`, no tree, no call).
 */
export function layoutComposedPairsGateAndDefer(
  ask: Ask,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  const layoutId = COMPOSED_PAIRS_GATE_AND_DEFER_LAYOUT_ID;
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

    if (visible.length <= 1) {
      const tree = visible.map(({ instanceId }) => tilingLeafToken(instanceId));
      if (!layoutFits(request, tree, visible))
        return deferAt(ctx, STAGE, 'no_feasible_layout', 'layout');
      return ok({
        plan,
        answers: [],
        source: 'jev',
        layoutId,
        tree,
        layoutSummary: describeLayoutChange(currentTree, tree),
        pairwise: { ...record, candidates: [] },
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
        state: {
          request: intentText(request),
          currentArrangement: describeLayout(currentTree),
          instances: visible.map((instance) => ({
            id: instance.instanceId,
            widget: instance.vesselId,
            variant: instance.variant,
          })),
        },
        questions: questions(visible, pairs),
      },
      ctx,
    );
    if (isErr(reply)) return reply;
    const read = readAll(reply.value, ids, pairs, ctx);
    if (isErr(read)) return read;
    const { pairAnswers, sizes, groupFractions, direction, records } =
      read.value;

    const ranked = rankArrangements(
      ids,
      pairAnswers.map(({ first, second, answer }) => ({
        first,
        second,
        probabilities: answer.probabilities,
      })),
      currentTree,
      direction.probabilities,
    );
    const shareById = sharesById(ids, sizes);
    const sizing: PartSizing = {
      innerSharesOf: (members: readonly InstanceId[]) =>
        partFractionShares(
          members.map((id) => {
            const answer = groupFractions[id];
            return answer && answer.stated >= STATED_PROBABILITY
              ? answer.fraction.size
              : undefined;
          }),
          members.map((id) => shareById[id] ?? 0),
        ),
    };
    const minimums = minimumFractions(request, visible);
    const fits = (tree: readonly TilingNode[]) =>
      layoutFits(request, tree, visible);
    const sized = ranked.slice(0, CANDIDATES).map(({ arrangement, score }) => ({
      score,
      asSized: arrangementTree(arrangement, shareById, sizing),
      raised: arrangementTreeAtMinimum(
        arrangement,
        shareById,
        minimums,
        sizing,
      ),
      equal: equalArrangementTree(arrangement),
    }));
    const candidates = sized.map(({ asSized, score }) => ({
      tree: asSized,
      score,
      fits: fits(asSized),
    }));
    const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
    const called = {
      ...record,
      called: true,
      pairs: pairAnswers,
      sizes,
      groupFractions,
      direction,
      candidates,
      margin,
    };
    const picked = pickSizedTree(sized, fits);
    if (picked === undefined)
      return deferAt(ctx, STAGE, 'no_feasible_layout', 'layout');
    const { tree, ...sizedHow } = picked;
    return ok({
      plan,
      source: 'jev',
      layoutId,
      tree,
      layoutSummary: describeLayoutChange(currentTree, tree),
      answers: records,
      pairwise: { ...called, ...sizedHow },
    });
  };
}

const STAGE = 'jevLayout';

/** How many of the top-scored trees are checked for fit. */
const CANDIDATES = 3;

/** The share each whole-Chart size level stands for, smallest first; the smallest is raised to the size floor. */
const SIZE_STEPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

const DIRECTION_QUESTION = 'direction';

/** The probability of yes at which a size counts as stated within its row or column. */
const STATED_PROBABILITY = 0.5;

function sharesById(
  ids: readonly InstanceId[],
  sizes: Readonly<Record<string, RecordedSize>>,
): Record<string, number> {
  const shares = sizeShares(ids.map((id) => sizes[id]?.size ?? 0));
  return Object.fromEntries(ids.map((id, index) => [id, shares[index] ?? 0]));
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

function statedInGroupQuestionId(id: InstanceId): string {
  return `size_stated_in_group/${id}`;
}

function fractionInGroupQuestionId(id: InstanceId): string {
  return `fraction_in_group/${id}`;
}

const FRACTION_TEXTS = [
  "a quarter of its row or column or less: signals: 'a quarter', 'a thin strip of the column', 'just a sliver'",
  "a third of its row or column: signals: 'a third', 'one of three equal rows', 'the rest when another widget gets two thirds'",
  "half of its row or column: signals: 'half', 'half the height', 'half the column', 'half of the row', 'one of two equal parts'",
  "two thirds of its row or column: signals: 'two thirds', 'twice the others' when it shares with one other widget",
  "three quarters of its row or column or more: signals: 'three quarters', 'most of the column', 'nearly all of the row'",
];

function questions(
  visible: readonly VesselInstanceSnapshot[],
  pairs: readonly (readonly [InstanceId, InstanceId])[],
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
        pairQuestion(nameOf(first), nameOf(second)),
      ]),
    ),
    ...Object.fromEntries(
      visible.map(({ instanceId, vesselId }) => [
        sizeQuestionId(instanceId),
        score(
          `How much of the chart does the \`request\` give ${instanceId} (the ${vesselId} widget)? Answer from the \`request\` alone.`,
          SIZE_LEVELS,
        ),
      ]),
    ),
    ...Object.fromEntries(
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
    ),
    [DIRECTION_QUESTION]: directionQuestion(),
  };
}

const STACK_PHRASES = [
  'stack them all',
  'in one column',
  'in a column',
  'one on top of the other',
];

const ROW_PHRASES = ['in a row', 'all side by side'];

function pairQuestion(a: NamedInstance, b: NamedInstance): ChoiceQuestion {
  const one = `${a.id} (the ${a.widget} widget)`;
  const other = `${b.id} (the ${b.widget} widget)`;
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
          ...ROW_PHRASES,
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
          ...ROW_PHRASES,
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
          ...STACK_PHRASES,
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
          ...STACK_PHRASES,
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
  const readScore = (question: string) => {
    const answer = readAnswer(reply, question, STAGE, ctx);
    if (isErr(answer)) return answer;
    if (!isScoreAnswer(answer.value))
      return deferAt(ctx, STAGE, 'answer_missing', question);
    records.push(answerRecord(question, answer.value));
    return ok(answer.value);
  };
  const sizes: Record<string, RecordedSize> = {};
  for (const id of ids) {
    const answer = readScore(sizeQuestionId(id));
    if (isErr(answer)) return answer;
    sizes[id] = recordedSize(
      answer.value,
      SIZE_STEPS[Number(answer.value.choice)] ?? 0,
    );
  }
  const groupFractions: Record<string, RecordedGroupFraction> = {};
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
  const direction = readAnswer(reply, DIRECTION_QUESTION, STAGE, ctx);
  if (isErr(direction)) return direction;
  records.push(answerRecord(DIRECTION_QUESTION, direction.value));
  return ok({
    pairAnswers,
    sizes,
    groupFractions,
    direction: recordedChoice(direction.value),
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
