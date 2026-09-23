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
  type ChoiceQuestion,
  choice,
  intentText,
  isScoreAnswer,
  type Question,
  type Reply,
  readAnswer,
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
  arrangementTree,
  NOT_STATED,
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
  /** Absent when no call was made. */
  readonly sizes?: Readonly<Record<string, RecordedSize>>;
  /** Jev's answer about the top-level split; present only when {@link layoutComposedPairsWithDirection} made a call. */
  readonly direction?: RecordedChoice;
  /** The top-scored trees, best first, each checked with `layoutFits`. */
  readonly candidates: readonly PairsCandidate[];
  /** Index into {@link candidates} of the returned tree. */
  readonly chosen?: number;
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
  return composedPairs(ask, false);
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
  return composedPairs(ask, true);
}

const STAGE = 'jevLayout';

/** How many of the top-scored trees are checked for fit. */
const CANDIDATES = 3;

const SIZE_LEVEL_COUNT = 5;

const DIRECTION_QUESTION = 'direction';

function composedPairs(
  ask: Ask,
  withDirection: boolean,
): Stage<GatedActionPlan, ComposedPairsDecision> {
  const layoutId = withDirection
    ? 'composed-pairs-with-direction'
    : 'composed-pairs';
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

    if (route === 'same_instances' && layoutFits(request, currentTree, visible))
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
        state: {
          request: intentText(request),
          currentArrangement: describeLayout(currentTree),
          instances: visible.map((instance) => ({
            id: instance.instanceId,
            widget: instance.vesselId,
            variant: instance.variant,
          })),
        },
        questions: {
          ...questions(visible, pairs),
          ...(withDirection && { [DIRECTION_QUESTION]: directionQuestion() }),
        },
      },
      ctx,
    );
    if (isErr(reply)) return reply;
    const read = readAll(reply.value, ids, pairs, ctx);
    if (isErr(read)) return read;
    const { pairAnswers, sizes, records } = read.value;
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
    );
    const shares = sizeShares(ids.map((id) => sizes[id]?.size ?? 0));
    const shareById = Object.fromEntries(
      ids.map((id, index) => [id, shares[index] ?? 0]),
    );
    const candidates = ranked
      .slice(0, CANDIDATES)
      .map(({ arrangement, score }) => {
        const tree = arrangementTree(arrangement, shareById);
        return { tree, score, fits: layoutFits(request, tree, visible) };
      });
    const margin = (ranked[0]?.score ?? 0) - (ranked[1]?.score ?? 0);
    const called = {
      ...record,
      called: true,
      pairs: pairAnswers,
      sizes,
      ...(direction && { direction }),
      candidates,
      margin,
    };
    const chosen = candidates.findIndex((candidate) => candidate.fits);
    const tree = candidates[chosen]?.tree;
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
  };
}

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
  const sizes: Record<string, RecordedSize> = {};
  for (const id of ids) {
    const question = sizeQuestionId(id);
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
      size: levelSize(Number(level), SIZE_LEVEL_COUNT),
    };
  }
  return ok({ pairAnswers, sizes, records });
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
