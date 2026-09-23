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

import { deferAt } from '../src/lib/defer.js';
import { finalVariants } from '../src/lib/final-variants.js';
import { layoutFits } from '../src/lib/layout-fit.js';
import {
  type Answer,
  choice,
  isScoreAnswer,
  type Question,
  type Reply,
  readAnswer,
  recentHistory,
  score,
} from '../src/lib/questions.js';
import {
  type ComposedAnswers,
  type ComposedLayoutDecision,
  type ComposedRoute,
  KEEP_ARRANGEMENT_NO_NEW_NOTE,
  KEEP_ARRANGEMENT_NOTE,
  type LayoutComposedOptions,
  type RecordedChoice,
  type RecordedSize,
  type SizeLevels,
} from '../src/lib/stages-experimental/layout-composed.js';
import {
  type CompositionAnswers,
  composeCandidates,
  POSITIONS,
} from '../src/lib/stages-experimental/layout-composed-tree.js';
import { describeLayout } from '../src/lib/stages-experimental/layout-describe.js';
import type { GatedActionPlan } from '../src/lib/stages-experimental/types.js';
import type { AnswerRecord } from '../src/lib/types.js';
import type { Ask } from '../src/lib/typesafe-client.js';

/**
 * The composed layout stage as it was before the size fix, kept only so the
 * stage eval can measure that fix: a size is read from the
 * probability-weighted score (5 levels) or the upper level's probability
 * (2 levels) instead of the chosen level, and the current arrangement in
 * words goes only to the nudged routes.
 */
export function layoutComposedScoreSized(
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
          views: visible,
          ...(nudged && {
            currentArrangement: describeLayout(currentTree),
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
      size:
        sizeLevels === 2
          ? (probabilities['1'] ?? 0)
          : answer.value.score / (sizeLevels - 1),
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
