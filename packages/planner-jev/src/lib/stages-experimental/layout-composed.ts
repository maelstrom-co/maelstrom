import type { Stage, StageContext } from '@maelstrom-co/engine';
import {
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
  choice,
  isScoreAnswer,
  type Question,
  type Reply,
  readAnswer,
  recentHistory,
  score,
} from '../questions.js';
import type { AnswerRecord } from '../types.js';
import type { Ask } from '../typesafe-client.js';
import {
  type ComposedCandidate,
  type CompositionAnswers,
  composeCandidates,
  type OptionProbabilities,
  POSITIONS,
} from './layout-composed-tree.js';
import { describeLayout } from './layout-describe.js';
import type { GatedActionPlan, LayoutDecision } from './types.js';

/** How many levels the size question rates on. */
export type SizeLevels = 2 | 5;

/** Options for {@link layoutComposed}. */
export interface LayoutComposedOptions {
  /** Levels of the size question: 5 descriptive levels (default) or 2. */
  readonly sizeLevels?: SizeLevels;
}

/**
 * Which gating case decided the call: `spatial` when the request states an
 * arrangement, `same_instances` when it does not and the visible Instances
 * are the current tree's, `instances_changed` when it does not and
 * Instances were added or removed.
 */
export type ComposedRoute = 'spatial' | 'same_instances' | 'instances_changed';

/** Why a composed layout was handed to the completion stage. */
export type ComposedHandOff = 'nothing_fits' | 'none_of_these';

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
   * The chosen level's size, up to 1, before normalising
   * across Instances. The chosen level, not the probability-weighted score,
   * so Instances given the same level get equal shares.
   */
  readonly size: number;
}

/** Every answer of the composed-layout call, by question kind and Instance. */
export interface ComposedAnswers {
  readonly shape: RecordedChoice;
  readonly placements: Readonly<Record<string, RecordedChoice>>;
  readonly positions: Readonly<Record<string, RecordedChoice>>;
  readonly sizes: Readonly<Record<string, RecordedSize>>;
}

/** A candidate tree and whether it fit the Chart and every minimum size. */
export type CheckedCandidate = ComposedCandidate & { readonly fits: boolean };

/** What {@link layoutComposed} did, so a wrong layout attributes to a gate case or an answer. */
export interface ComposedLayoutRecord {
  readonly route: ComposedRoute;
  /** Whether a Jev call was made. */
  readonly called: boolean;
  /** Whether the call's state carried the note to keep the current arrangement. */
  readonly nudged: boolean;
  readonly sizeLevels: SizeLevels;
  /** Absent when no call was made. */
  readonly answers?: ComposedAnswers;
  /** The top candidates, most probable first, each checked with `layoutFits`. */
  readonly candidates: readonly CheckedCandidate[];
  /** Index into {@link candidates} of the returned tree. */
  readonly chosen?: number;
  readonly handOff?: ComposedHandOff;
}

/** A layout decision with the composed-layout record. */
export type ComposedLayoutDecision = LayoutDecision & {
  readonly composition: ComposedLayoutRecord;
};

/** The note added to the call's state when the request states no arrangement but Instances were added. */
export const KEEP_ARRANGEMENT_NOTE =
  'The user did not ask to change the arrangement. Keep the other Instances where they are. Put the new Instance where it fits best.';

/** The note added to the call's state when the request states no arrangement and no Instance was added. */
export const KEEP_ARRANGEMENT_NO_NEW_NOTE =
  'The user did not ask to change the arrangement. Keep the Instances where they are as far as the chart allows.';

/**
 * Composes the layout from Jev's answers about its parts, in one call of
 * `3n + 1` questions for `n` visible Instances: the shape (top-level
 * direction and part count), then per Instance its part, its position in
 * the part and its share of the Chart. Code assembles the three most
 * probable trees (see {@link composeCandidates}) and returns the most
 * probable one that fits (`source: 'jev'`), or hands off (`source: 'llm'`,
 * no tree) when none fits or Jev says the arrangement needs more than four
 * parts or a deeper split.
 *
 * Reads the `spatial` gate: with no stated arrangement and the same visible
 * Instances, the current tree is kept when it fits (`source: 'preserve'`,
 * no call); otherwise the call carries a note to keep the current
 * arrangement. Every call carries the current arrangement in words. With
 * at most one visible Instance there is only one tree and no call is made.
 */
export function layoutComposed(
  ask: Ask,
  options: LayoutComposedOptions = {},
): Stage<GatedActionPlan, ComposedLayoutDecision> {
  const sizeLevels = options.sizeLevels ?? 5;
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
    const added = visible.filter(
      ({ instanceId }) => !currentIds.has(instanceId),
    );
    const route: ComposedRoute =
      plan.gates.spatial.answer === 'yes'
        ? 'spatial'
        : added.length === 0 && currentIds.size === visible.length
          ? 'same_instances'
          : 'instances_changed';
    const record = { route, sizeLevels, called: false, nudged: false };

    if (route === 'same_instances' && layoutFits(request, currentTree, visible))
      return ok({
        plan,
        source: 'preserve',
        layoutId: 'preserve',
        tree: currentTree,
        answers: [],
        composition: { ...record, candidates: [] },
      });

    if (visible.length <= 1) {
      const tree = visible.map(({ instanceId }) => tilingLeafToken(instanceId));
      const fits = layoutFits(request, tree, visible);
      return ok({
        plan,
        answers: [],
        ...(fits
          ? { source: 'jev', layoutId: 'composed', tree }
          : { source: 'llm' }),
        composition: {
          ...record,
          candidates: [],
          ...(!fits && { handOff: 'nothing_fits' }),
        },
      });
    }

    const nudged = route !== 'spatial';
    const ids = visible.map(({ instanceId }) => instanceId);
    const reply = await ask(
      STAGE,
      {
        state: {
          intent: request.context.updateReasons,
          history: recentHistory(plan.selection.input.history),
          chartDimensions: request.context.chartDimensions,
          currentLayout: currentTree,
          currentArrangement: describeLayout(currentTree),
          views: visible,
          ...(nudged && {
            arrangementNote:
              added.length > 0
                ? KEEP_ARRANGEMENT_NOTE
                : KEEP_ARRANGEMENT_NO_NEW_NOTE,
            ...(added.length > 0 && {
              newInstances: added.map(({ instanceId }) => instanceId),
            }),
          }),
        },
        questions: questions(ids, sizeLevels),
      },
      ctx,
    );
    if (isErr(reply)) return reply;
    const read = readAll(reply.value, ids, sizeLevels, ctx);
    if (isErr(read)) return read;
    const { answers, records } = read.value;
    const called = { ...record, called: true, nudged, answers };

    if (isHandOffShape(answers.shape.choice))
      return ok({
        plan,
        source: 'llm',
        answers: records,
        composition: {
          ...called,
          candidates: [],
          handOff: answers.shape.choice,
        },
      });

    const candidates = composeCandidates(compositionAnswers(ids, answers)).map(
      (candidate) => ({
        ...candidate,
        fits: layoutFits(request, candidate.tree, visible),
      }),
    );
    const chosen = candidates.findIndex((candidate) => candidate.fits);
    const tree = candidates[chosen]?.tree;
    if (tree === undefined)
      return ok({
        plan,
        source: 'llm',
        answers: records,
        composition: { ...called, candidates, handOff: 'nothing_fits' },
      });
    return ok({
      plan,
      source: 'jev',
      layoutId: 'composed',
      tree,
      answers: records,
      composition: { ...called, candidates, chosen },
    });
  };
}

/**
 * The size of a chosen level. On 5 levels the lowest reads as 0 ("as small
 * as it can be", raised to the size floor); on 2 levels the lower one is
 * half the upper one, so "small" still reads as a real share.
 */
export function levelSize(level: number, sizeLevels: SizeLevels): number {
  return sizeLevels === 2 ? (level + 1) / 2 : level / (sizeLevels - 1);
}

const STAGE = 'jevLayout';

/** Stands in for the probability of a choice answered without a distribution and with no confidence. */
const MIN_PROBABILITY = 1e-6;

const HAND_OFF_SHAPE = 'none_of_these';

const SHAPE_TEXTS: Readonly<Record<string, string>> = {
  side_by_side_2: 'Two parts side by side, part 1 on the left.',
  side_by_side_3: 'Three parts side by side, part 1 on the left.',
  side_by_side_4: 'Four parts side by side, part 1 on the left.',
  stacked_2: 'Two parts stacked, part 1 at the top.',
  stacked_3: 'Three parts stacked, part 1 at the top.',
  stacked_4: 'Four parts stacked, part 1 at the top.',
  [HAND_OFF_SHAPE]:
    'None of these: the request asks for more than four parts, or for a part inside a part to be divided again.',
};

/** The most parts a composed shape or placement question offers. */
const MAX_PARTS = 4;

/**
 * Shape options up to `partCount` parts (2 to {@link MAX_PARTS}), side by
 * side then stacked, plus {@link HAND_OFF_SHAPE}.
 */
function shapeOptions(partCount: number): Readonly<Record<string, string>> {
  const counts = [2, 3, 4].filter((count) => count <= partCount);
  const keys = [
    ...counts.map((count) => `side_by_side_${count}`),
    ...counts.map((count) => `stacked_${count}`),
    HAND_OFF_SHAPE,
  ];
  return Object.fromEntries(keys.map((key) => [key, SHAPE_TEXTS[key]]));
}

const PART_TEXTS: Readonly<Record<string, string>> = {
  part_1:
    'The first part: leftmost when the parts are side by side, top when stacked.',
  part_2: 'The second part.',
  part_3: 'The third part.',
  part_4: 'The fourth part.',
};

/** Placement options up to `partCount` parts (1 to {@link MAX_PARTS}). */
function partOptions(partCount: number): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Array.from({ length: partCount }, (_, index) => {
      const key = `part_${index + 1}`;
      return [key, PART_TEXTS[key]];
    }),
  );
}

const POSITION_OPTIONS: Readonly<Record<string, string>> = {
  first: 'First in its part: leftmost or topmost.',
  second: 'Second in its part.',
  third: 'Third in its part.',
  fourth: 'Fourth in its part.',
  fifth: 'Fifth in its part.',
};

const SIZE_LEVELS: Readonly<Record<SizeLevels, readonly string[]>> = {
  5: [
    'tiny: as small as it can be',
    'small',
    'medium',
    'large',
    'very large: the biggest widget on the chart',
  ],
  2: ['as small as possible', 'as large as possible'],
};

function questions(
  ids: readonly InstanceId[],
  sizeLevels: SizeLevels,
): Record<string, Question> {
  const partCount = Math.min(ids.length, MAX_PARTS);
  const positions = Object.fromEntries(
    POSITIONS.slice(0, ids.length).map((position) => [
      position,
      POSITION_OPTIONS[position] ?? position,
    ]),
  );
  return {
    shape: choice(
      'How is the chart divided at the top level? Instances placed in the same part are arranged the other way inside it: stacked inside a part of a side by side shape, side by side inside a part of a stacked shape. With every visible instance in its own part the layout is flat. Choose "none of these" only when the request explicitly asks for an arrangement it describes.',
      shapeOptions(partCount),
    ),
    ...Object.fromEntries(
      ids.flatMap((id) => [
        [
          `placement/${id}`,
          choice(
            `Which part of the chosen shape holds ${id}? Part 1 is the leftmost part when the parts are side by side and the top part when they are stacked.`,
            partOptions(partCount),
          ),
        ],
        [
          `position/${id}`,
          choice(
            `Where does ${id} come among the instances in its part? First is leftmost when they are side by side and topmost when they are stacked. An instance alone in its part is first.`,
            positions,
          ),
        ],
        [
          `size/${id}`,
          score(
            `How much of the whole chart, by area, should ${id} take?`,
            SIZE_LEVELS[sizeLevels],
          ),
        ],
      ]),
    ),
  };
}

function readAll(
  reply: Reply,
  ids: readonly InstanceId[],
  sizeLevels: SizeLevels,
  ctx: StageContext,
) {
  const records: AnswerRecord[] = [];
  const readChoice = (question: string) => {
    const answer = readAnswer(reply, question, STAGE, ctx);
    if (isErr(answer)) return answer;
    records.push(answerRecord(question, answer.value));
    return ok(recordedChoice(answer.value));
  };
  const shape = readChoice('shape');
  if (isErr(shape)) return shape;
  const placements: Record<string, RecordedChoice> = {};
  const positions: Record<string, RecordedChoice> = {};
  const sizes: Record<string, RecordedSize> = {};
  for (const id of ids) {
    const placement = readChoice(`placement/${id}`);
    if (isErr(placement)) return placement;
    placements[id] = placement.value;
    const position = readChoice(`position/${id}`);
    if (isErr(position)) return position;
    positions[id] = position.value;
    const question = `size/${id}`;
    const answer = readAnswer(reply, question, STAGE, ctx);
    if (isErr(answer)) return answer;
    if (!isScoreAnswer(answer.value))
      return deferAt(ctx, STAGE, 'answer_missing', question);
    records.push(answerRecord(question, answer.value));
    const { choice: level, confidence, probabilities } = answer.value;
    sizes[id] = {
      level,
      score: answer.value.score,
      confidence,
      probabilities,
      size: levelSize(Number(level), sizeLevels),
    };
  }
  const answers: ComposedAnswers = {
    shape: shape.value,
    placements,
    positions,
    sizes,
  };
  return ok({ answers, records });
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
      [answer.choice]: Math.max(answer.confidence, MIN_PROBABILITY),
    },
  };
}

function compositionAnswers(
  ids: readonly InstanceId[],
  answers: ComposedAnswers,
): CompositionAnswers {
  return {
    shape: answers.shape.probabilities,
    instances: ids.map((instanceId) => ({
      instanceId,
      placement: answers.placements[instanceId]?.probabilities ?? {},
      position: answers.positions[instanceId]?.probabilities ?? {},
      size: answers.sizes[instanceId]?.size ?? 0,
    })),
  };
}

function isHandOffShape(shape: string): shape is typeof HAND_OFF_SHAPE {
  return shape === HAND_OFF_SHAPE;
}
