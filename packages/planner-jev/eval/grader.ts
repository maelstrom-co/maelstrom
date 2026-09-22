import type { StageContext } from '@maelstrom-co/engine';
import {
  type ActionExecution,
  type ChartRequest,
  isErr,
  type TilingNode,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';

import {
  type Evaluation,
  intentText,
  isScoreAnswer,
  type Question,
  score,
} from '../src/lib/questions.js';
import type { Ask, JevCall } from '../src/lib/typesafe-client.js';
import { VERBALIZER_VERSION, verbalizeTree } from './verbalize-tree.js';

/** Bumped whenever the grader's questions, levels or state change, so a stored grade records which wording produced it. */
export const GRADER_VERSION = 1;

/** The dimensions the grader rates each shipped response on. */
export const GRADER_DIMENSIONS = [
  'request_satisfied',
  'arrangement_match',
] as const;

/** One dimension the grader rates. */
export type GraderDimension = (typeof GRADER_DIMENSIONS)[number];

/** Levels of `request_satisfied`, lowest first. */
export const REQUEST_SATISFIED_LEVELS = [
  'Nothing the user asked for happened, for example the calendar was hidden when the map was requested.',
  'Little of what the user asked for happened: the main request is missing or wrong, for example the map was shown but set to a different city than the one named.',
  'Part of what the user asked for happened and part did not, for example the map was shown but the task the user dictated was not added.',
  'Everything asked for happened, but something else changed that nobody asked for, for example another widget was hidden or switched to a different view.',
  'Everything asked for happened and nothing else changed.',
] as const;

/** Levels of `arrangement_match`, lowest first. */
export const ARRANGEMENT_MATCH_LEVELS = [
  'Layout contradicts the stated arrangement: the big widget is on the wrong side or the order is reversed.',
  'Layout misses most of the stated arrangement, for example the widgets sit side by side but not in the stated order; with none stated, the previous arrangement was reshuffled for no reason.',
  'Layout follows the main placement of the stated arrangement but gets a stated size or position clearly wrong, for example the map is on the right but no bigger than the calendar.',
  'Layout follows the stated arrangement with a small deviation, for example the strip is along the bottom but thicker than asked; with none stated, the previous arrangement is kept with minor size changes.',
  'Layout is exactly the stated arrangement; with none stated, the previous arrangement is preserved or a sensible default is used.',
] as const;

/** Resample a dimension when its two most probable levels are at most this far apart. */
export const NEAR_BOUNDARY_MARGIN = 0.15;

/** Samples taken of a dimension near a level boundary, the first included. */
export const NEAR_BOUNDARY_SAMPLES = 3;

/** What a planner shipped: the parts of a validated response the grader reads. */
export interface ShippedResponse {
  readonly userMessage: string;
  readonly executionPlan: readonly ActionExecution[];
  readonly tree: readonly TilingNode[];
  /** Every retained instance in the variant the response leaves it in. */
  readonly instances: readonly VesselInstanceSnapshot[];
}

/** One shipped response and the request it answers. */
export interface GradeInput {
  readonly request: ChartRequest;
  readonly response: ShippedResponse;
}

/** One dimension's grade: `score` is the mean raw level over `samples`, normalised to [0, 1]. */
export interface DimensionGrade {
  readonly score: number;
  /** Raw fractional levels, one per sample, from 0 to levels - 1. */
  readonly samples: readonly number[];
}

/** The grader's verdict on one shipped response: every dimension, or why it could not grade. */
export interface GraderGrade {
  readonly graderVersion: number;
  readonly verbalizerVersion: number;
  readonly dimensions?: Readonly<Record<GraderDimension, DimensionGrade>>;
  /** `grader/<code>` for a deferral, or the cancellation message. */
  readonly failure?: string;
}

/** One TypeSafe call the grader made, as the client reported it. */
export type GraderCall = Pick<JevCall, 'latencyMs' | 'usage' | 'outcome'>;

/** A grade and the calls that produced it, as a run record stores it. */
export interface GraderRecord extends GraderGrade {
  readonly calls: readonly GraderCall[];
}

/** The part of a stage context the TypeSafe client reads. */
export type GraderContext = Pick<StageContext, 'logger' | 'signal'>;

/**
 * Grades one shipped response with one TypeSafe call asking both score
 * questions. A dimension whose two most probable levels are within
 * {@link NEAR_BOUNDARY_MARGIN} is asked again, alone, until it has
 * {@link NEAR_BOUNDARY_SAMPLES} samples, and scores their mean. Never
 * throws on a provider failure: any failed call fails the whole grade.
 */
export async function gradeResponse(
  ask: Ask,
  input: GradeInput,
  ctx: GraderContext,
): Promise<GraderGrade> {
  const versions = {
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
  };
  const state = graderState(input);
  const samples = Object.fromEntries(
    GRADER_DIMENSIONS.map((dimension) => [dimension, [] as number[]]),
  ) as Record<GraderDimension, number[]>;

  const first = await askDimensions(ask, state, GRADER_DIMENSIONS, ctx);
  if ('failure' in first) return { ...versions, failure: first.failure };
  const nearBoundary: GraderDimension[] = [];
  for (const dimension of GRADER_DIMENSIONS) {
    const answer = first.answers[dimension];
    samples[dimension].push(answer.score);
    if (topTwoGap(answer.probabilities) <= NEAR_BOUNDARY_MARGIN + 1e-9)
      nearBoundary.push(dimension);
  }
  if (nearBoundary.length > 0)
    for (let sample = 1; sample < NEAR_BOUNDARY_SAMPLES; sample++) {
      const again = await askDimensions(ask, state, nearBoundary, ctx);
      if ('failure' in again) return { ...versions, failure: again.failure };
      for (const dimension of nearBoundary)
        samples[dimension].push(again.answers[dimension].score);
    }

  const dimensionGrade = (dimension: GraderDimension): DimensionGrade => {
    const raw = samples[dimension];
    const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
    return { score: mean / (LEVELS[dimension].length - 1), samples: raw };
  };
  const dimensions = {
    request_satisfied: dimensionGrade('request_satisfied'),
    arrangement_match: dimensionGrade('arrangement_match'),
  };
  return { ...versions, dimensions };
}

const LEVELS: Readonly<Record<GraderDimension, readonly string[]>> = {
  request_satisfied: REQUEST_SATISFIED_LEVELS,
  arrangement_match: ARRANGEMENT_MATCH_LEVELS,
};

const QUESTIONS: Readonly<Record<GraderDimension, Question>> = {
  request_satisfied: score(
    'Rate how fully the response did what the user asked in intent. before and after describe the layout before and after the response, executionPlan lists the actions it ran, and userMessage is what it told the user. Judge what actually changed, not how the message reads.',
    REQUEST_SATISFIED_LEVELS,
  ),
  arrangement_match: score(
    'Rate how well the layout in after matches the arrangement the user stated in intent: which widget sits where, their order and their relative sizes. When intent states no arrangement, compare after with before instead. Judge the layout descriptions, not the message.',
    ARRANGEMENT_MATCH_LEVELS,
  ),
};

interface ScoredAnswer {
  readonly score: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

async function askDimensions(
  ask: Ask,
  state: Record<string, unknown>,
  dimensions: readonly GraderDimension[],
  ctx: GraderContext,
): Promise<
  | { readonly answers: Readonly<Record<string, ScoredAnswer>> }
  | { readonly failure: string }
> {
  const evaluation: Evaluation = {
    state,
    questions: Object.fromEntries(
      dimensions.map((dimension) => [dimension, QUESTIONS[dimension]]),
    ),
  };
  // The client reads only the logger and signal; the grader runs outside any pipeline.
  const result = await ask('grader', evaluation, ctx as StageContext);
  if (isErr(result))
    return {
      failure:
        result.error._tag === 'Deferred'
          ? result.error.reason
          : result.error.message,
    };
  const answers: Record<string, ScoredAnswer> = {};
  for (const dimension of dimensions) {
    const answer = result.value.answers[dimension];
    if (answer === undefined || !isScoreAnswer(answer))
      return { failure: 'grader/answer_missing' };
    answers[dimension] = answer;
  }
  return { answers };
}

function graderState({ request, response }: GradeInput) {
  const before =
    request.layout.type === 'tiling'
      ? verbalizeTree({ request, tree: request.layout.tree })
      : '(not a tiling layout)';
  return {
    intent: intentText(request),
    before,
    after: verbalizeTree({
      request: { ...request, instances: response.instances },
      tree: response.tree,
    }),
    executionPlan: response.executionPlan.map((step) => ({
      instanceId: step.instanceId,
      action: step.action,
      ...(step.params !== undefined && { params: step.params }),
    })),
    userMessage: response.userMessage,
  };
}

function topTwoGap(probabilities: Readonly<Record<string, number>>): number {
  const [top = 0, second = 0] = Object.values(probabilities).sort(
    (a, b) => b - a,
  );
  return top - second;
}
