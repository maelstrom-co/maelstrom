import {
  type AnswerRecord,
  type JevActionPlan,
  type JevCall,
  type JevCaller,
  type LayoutSource,
  type Selection2,
  STAGE_NAME,
} from '@maelstrom-co/planner-jev/_internal';
import type { TilingNode } from '@maelstrom-co/protocol';
import type { StageRecord } from '../../core/instrument.js';
import type { RunRecord } from '../../core/run.js';
import type { Scenario } from '../../core/scenarios.js';
import {
  type ArrangedScore,
  type Score,
  scoreLayout,
} from '../../core/score.js';
import { scoreActions, scoreSelection } from './score.js';

/** One Jev answer from a validated reply, flattened for the records. */
export interface RecordedAnswer {
  readonly stage: JevCaller;
  readonly question: string;
  readonly choice: string;
  /** The chosen option's probability. */
  readonly probability?: number;
  readonly confidence: number;
}

/** What each Jev stage decided in one turn, as the run record keeps it. */
export interface StageOutputs {
  readonly jevSelect?: {
    readonly instances: Selection2['instances'];
    readonly answers: readonly AnswerRecord[];
    readonly gates?: Selection2['gates'];
  };
  readonly jevActions?: {
    readonly actions: JevActionPlan['actions'];
    readonly asks: JevActionPlan['asks'];
    readonly answers: readonly AnswerRecord[];
  };
  readonly jevLayout?: LayoutStageOutput;
}

/** The layout stage's decision, as the run record keeps it. */
export interface LayoutStageOutput {
  /** Absent for the POC, whose layout stage always decides through Jev. */
  readonly source?: LayoutSource;
  readonly layoutId?: string;
  /** Absent when the layout was handed to the completion call. */
  readonly tree?: readonly TilingNode[];
  readonly answers: readonly AnswerRecord[];
}

/** The fields {@link jevTurnFields} adds to a Jev arm's run record. */
export type JevTurnFields = {
  readonly stageScores?: {
    readonly selection?: Score;
    readonly actions?: Score;
    readonly layout?: ArrangedScore;
  };
  readonly stageOutputs?: StageOutputs;
  readonly jevCalls?: readonly JevCall[];
  /**
   * Every answer of every validated live Jev reply, deferred stages
   * included. Replayed stages make no calls, so their answers are absent.
   */
  readonly answers?: readonly RecordedAnswer[];
  /**
   * Lowest confidence among the answers the completed stages consumed,
   * replayed stages included; recorded, not enforced.
   */
  readonly minConfidence?: number;
  /** `stated_elsewhere` slots the actions stage left for the LLM, and how many it filled. */
  readonly fill?: { readonly slots: number; readonly filled: number };
};

/** A run record of a Jev arm, with the plugin's fields typed. */
export type JevRunRecord = RunRecord & JevTurnFields;

/** What the Jev plugin records of one turn beyond the runner's own fields. */
export function jevTurnFields(
  scenario: Scenario,
  stages: readonly StageRecord[],
  calls: readonly JevCall[],
): JevTurnFields {
  const outputOf = <T>(stage: string) =>
    stages.find((record) => record.stage === stage && record.outcome === 'ok')
      ?.output as T | undefined;
  const selection = outputOf<Selection2>(STAGE_NAME.jevSelect);
  const actions = outputOf<JevActionPlan>(STAGE_NAME.jevActions);
  const layout = outputOf<LayoutOutput>(STAGE_NAME.jevLayout);
  const fill = actions && fillOf(actions, stages);
  const consumed: AnswerRecord[] = [
    ...(selection?.answers ?? []),
    ...(actions?.answers ?? []),
    ...(layout?.answers ?? []),
  ];
  return {
    stageScores: {
      ...(selection && { selection: scoreSelection(scenario, selection) }),
      ...(actions && { actions: scoreActions(scenario, actions) }),
      ...(layout?.tree && {
        layout: scoreLayout(scenario, { tree: layout.tree }),
      }),
    },
    stageOutputs: {
      ...(selection && {
        jevSelect: {
          instances: selection.instances,
          answers: selection.answers,
          ...(selection.gates && { gates: selection.gates }),
        },
      }),
      ...(actions && {
        jevActions: {
          actions: actions.actions,
          asks: actions.asks,
          answers: actions.answers,
        },
      }),
      ...(layout && {
        jevLayout: {
          ...(layout.source && { source: layout.source }),
          layoutId: layout.layoutId,
          tree: layout.tree,
          answers: layout.answers,
        },
      }),
    },
    jevCalls: calls,
    answers: calls.flatMap(flattenAnswers),
    ...(consumed.length > 0 && {
      minConfidence: Math.min(...consumed.map((answer) => answer.confidence)),
    }),
    ...(fill && { fill }),
  };
}

/**
 * What a layout stage returns: the POC's plan, or a stage-library decision
 * that carries its `source` and leaves `tree` undefined to hand the layout
 * to the completion call.
 */
interface LayoutOutput {
  readonly source?: LayoutSource;
  readonly layoutId?: string;
  readonly tree?: readonly TilingNode[];
  readonly answers: readonly AnswerRecord[];
}

function flattenAnswers(call: JevCall): RecordedAnswer[] {
  return Object.entries(call.answers ?? {}).map(([question, answer]) => {
    const probability = answer.probabilities?.[answer.choice];
    return {
      stage: call.stage,
      question,
      choice: answer.choice,
      ...(probability !== undefined && { probability }),
      confidence: answer.confidence,
    };
  });
}

/**
 * Slots count as filled when `llmComplete` got past the fill: it returned a
 * candidate, or deferred for a reason other than `param_unfilled`. A
 * `param_unfilled` deferral counts every slot of that turn as unfilled. A
 * turn that never reached `llmComplete`, or whose call failed, is left out.
 */
function fillOf(
  actions: JevActionPlan,
  stages: readonly StageRecord[],
): { slots: number; filled: number } | undefined {
  const complete = stages.find(
    (record) => record.stage === STAGE_NAME.llmComplete,
  );
  if (complete === undefined || complete.outcome === 'error') return undefined;
  const slots = actions.actions.reduce(
    (count, action) => count + action.pending.length,
    0,
  );
  return {
    slots,
    filled: complete.reason === 'llmComplete/param_unfilled' ? 0 : slots,
  };
}
