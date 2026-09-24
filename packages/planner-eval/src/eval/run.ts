import {
  createEngine,
  type Logger,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
} from '@maelstrom-co/engine';
import {
  type AnswerRecord,
  type Ask,
  createTypeSafeClient,
  type JevActionPlan,
  type JevCall,
  type JevCaller,
  type LayoutSource,
  type Selection2,
  type StageName,
} from '@maelstrom-co/planner-jev/_eval';
import {
  type ActionExecution,
  ChartRequestMessage,
  isOk,
  type MaelstromResponse,
  MessageId,
  SessionId,
  type TilingNode,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { type Arm, type ArmKind, demoLlmPlanner } from './arms.js';
import {
  GRADER_VERSION,
  type GraderCall,
  type GraderGrade,
  type GraderRecord,
  gradeResponse,
} from './grader.js';
import {
  createRecorder,
  type StageRecord,
  type StageReplacements,
} from './instrument.js';
import {
  type ReplaySource,
  replayStage,
  verifyReplay,
  verifyReplayShape,
  writeStageFile,
} from './replay.js';
import type { Scenario, Suite } from './scenarios.js';
import {
  type ArrangedScore,
  type Score,
  scoreActions,
  scoreLayout,
  scoreResponse,
  scoreSelection,
} from './score.js';
import { type LlmCall, type LlmRole, withUsage } from './usage-adapter.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

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

export interface RunRecord {
  readonly scenarioId: string;
  readonly suite: Suite;
  /** The arm's registry name. */
  readonly arm: string;
  readonly kind: ArmKind;
  readonly repeat: number;
  /** Wall time of `engine.handle` for the turn. */
  readonly turnMs: number;
  readonly userMessage?: string;
  readonly error?: { readonly tag: string; readonly message: string };
  /** The scenario expects the POC to defer; excluded from every arm's overall pass rate. */
  readonly expectedDeferral: boolean;
  /** The scenario declares arrangement rules. */
  readonly arrangementRules: boolean;
  /** The scenario's spatial tag, when it has one. */
  readonly spatial?: boolean;
  /** Whether the scenario expects any action, when it states its actions. */
  readonly expectsActions?: boolean;
  /** Overall score of the shipped response (planned scenarios only). */
  readonly score?: ArrangedScore;
  /** Jev arms only: whether it deferred at the expected stage (expected-deferral scenarios). */
  readonly deferredAsExpected?: boolean;
  readonly deferral?: {
    readonly stage: StageName;
    readonly reason: string;
    readonly provider: boolean;
  };
  readonly fallbackCalls?: number;
  readonly stageScores?: {
    readonly selection?: Score;
    readonly actions?: Score;
    readonly layout?: ArrangedScore;
  };
  readonly stages?: readonly Omit<StageRecord, 'input' | 'output'>[];
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
  /** Every LLM call of the turn, by role. */
  readonly llmCalls?: readonly LlmCall[];
  /** `stated_elsewhere` slots the actions stage left for the LLM, and how many it filled. */
  readonly fill?: { readonly slots: number; readonly filled: number };
  readonly tree?: readonly unknown[];
  /** The shipped execution plan; absent from records written before the grader. */
  readonly executionPlan?: readonly ActionExecution[];
  /** Every retained instance the shipped layout declares; absent from records written before the grader. */
  readonly instances?: readonly VesselInstanceSnapshot[];
  /**
   * The grader's verdict on the shipped response (`--grader`, planned
   * scenarios only), with its own TypeSafe calls, which are never counted
   * in `jevCalls`.
   */
  readonly grader?: GraderRecord;
}

export interface EvalOptions {
  readonly scenarios: readonly Scenario[];
  /** Run in this order for every scenario and repeat. */
  readonly arms: readonly Arm[];
  readonly repeats: number;
  /** Text adapter behind every LLM role; each role gets its own recording wrapper. */
  readonly adapter: AnyTextAdapter;
  readonly typesafe: {
    readonly apiKey: string;
    readonly model: string;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
  };
  readonly logger?: Logger;
  /** Called after every turn, for progress output. */
  readonly onRecord?: (record: RunRecord) => void;
  /** Output directory; each Jev turn's stage records are written under `<out>/stages/<arm>/`. */
  readonly out?: string;
  /**
   * Grade every planned shipped response with the TypeSafe grader, after
   * the turn's latency is measured, through its own client.
   */
  readonly grader?: boolean;
  /** Stages every Jev arm replays from a recorded run instead of running live. */
  readonly replay?: {
    readonly source: ReplaySource;
    readonly stages: readonly StageName[];
  };
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Runs every scenario `repeats` times through each arm and scores the
 * shipped response. Every arm plans through `createEngine` with history off
 * and `retry: false`: the baseline is the same once-retried LLM planner the
 * Jev arms fall back to, so the arms differ only in their pipelines.
 *
 * @throws {Error} Before any turn runs, when `options.replay` did not record
 *   every scenario and repeat from the same request and history, or lacks
 *   fields an arm reads from a replayed stage.
 */
export async function runEval(options: EvalOptions): Promise<RunRecord[]> {
  if (options.replay) {
    verifyReplay(options.replay.source, options.scenarios, options.repeats);
    verifyReplayShape(
      options.replay.source,
      options.scenarios,
      options.repeats,
      options.replay.stages,
      options.arms.filter((arm) => arm.kind !== 'baseline'),
    );
  }
  const grader = options.grader ? graderClient(options) : undefined;
  const records: RunRecord[] = [];
  for (const scenario of options.scenarios)
    for (let repeat = 1; repeat <= options.repeats; repeat++)
      for (const arm of options.arms) {
        const turn = await runTurn(options, arm, scenario, repeat);
        const record =
          grader && turn.response
            ? { ...turn.record, grader: await grader(scenario, turn.response) }
            : turn.record;
        records.push(record);
        options.onRecord?.(record);
      }
  return records;
}

/**
 * Grades one shipped response: `grader/not_tiling` for a non-tiling
 * layout, or `grader/exception` for any exception `ask` or the grading
 * itself raises. The grader is secondary and must never abort a run or
 * change a turn's primary result.
 */
export async function grade(
  ask: Ask,
  scenario: Scenario,
  response: MaelstromResponse,
  logger: Logger,
): Promise<GraderGrade> {
  const { layout } = response;
  if (layout.type !== 'tiling')
    return {
      graderVersion: GRADER_VERSION,
      verbalizerVersion: VERBALIZER_VERSION,
      failure: 'grader/not_tiling',
    };
  try {
    return await gradeResponse(
      ask,
      {
        request: scenario.request,
        response: {
          userMessage: response.userMessage,
          executionPlan: response.executionPlan,
          tree: layout.tree,
          instances: layout.instances,
        },
      },
      { logger },
    );
  } catch {
    return {
      graderVersion: GRADER_VERSION,
      verbalizerVersion: VERBALIZER_VERSION,
      failure: 'grader/exception',
    };
  }
}

type Grader = (
  scenario: Scenario,
  response: MaelstromResponse,
) => Promise<GraderRecord>;

/** Grades on a client of its own, so its calls never reach an arm's recorder. */
function graderClient(options: EvalOptions): Grader {
  let calls: GraderCall[] = [];
  const ask: Ask = createTypeSafeClient({
    ...options.typesafe,
    onCall: ({ latencyMs, usage, outcome }) =>
      calls.push({ latencyMs, outcome, ...(usage && { usage }) }),
  });
  return async (scenario, response) => {
    calls = [];
    return {
      ...(await grade(ask, scenario, response, options.logger ?? silent)),
      calls,
    };
  };
}

/** A turn's record, and the planned response to grade when it shipped one. */
async function runTurn(
  options: EvalOptions,
  arm: Arm,
  scenario: Scenario,
  repeat: number,
): Promise<{ record: RunRecord; response?: MaelstromResponse }> {
  const jev = arm.kind !== 'baseline';
  const llmCalls: LlmCall[] = [];
  const adapter = (role: LlmRole) =>
    withUsage(options.adapter, role, (call) => llmCalls.push(call));
  const replay = jev ? options.replay : undefined;
  const replacements: StageReplacements = replay
    ? Object.fromEntries(
        replay.stages.map((name) => [
          name,
          replayStage(name, replay.source.turn(scenario.id, repeat)),
        ]),
      )
    : {};
  const recorder = createRecorder(replacements);
  let fallbackCalls = 0;
  const fallback = demoLlmPlanner(adapter('fallback'));
  const counted: Stage<Retryable<PlanningInput>, PlannerCandidate> = (
    input,
    ctx,
  ) => {
    fallbackCalls += 1;
    return fallback(input, ctx);
  };
  const planner = arm.build({
    typesafe: { ...options.typesafe, onCall: recorder.onCall },
    adapter,
    fallback: counted,
    instrument: recorder.instrument,
  });
  const turn = await handle(options, scenario, repeat, arm.name, planner);
  const record = {
    ...base(scenario, repeat, arm, turn),
    llmCalls,
    ...(jev && jevFields(scenario, recorder, fallbackCalls)),
    ...(turn.response &&
      scenario.expected.status === 'planned' && {
        score: scoreResponse(scenario, turn.response),
      }),
  };
  if (jev && options.out !== undefined)
    await writeStageFile(options.out, {
      arm: arm.name,
      scenarioId: scenario.id,
      repeat,
      stages: recorder.stages,
    });
  return {
    record,
    ...(turn.response &&
      scenario.expected.status === 'planned' && { response: turn.response }),
  };
}

function jevFields(
  scenario: Scenario,
  recorder: ReturnType<typeof createRecorder>,
  fallbackCalls: number,
): Partial<RunRecord> {
  const outputOf = <T>(stage: StageName) =>
    recorder.stages.find(
      (record) => record.stage === stage && record.outcome === 'ok',
    )?.output as T | undefined;
  const selection = outputOf<Selection2>('jevSelect');
  const actions = outputOf<JevActionPlan>('jevActions');
  const layout = outputOf<LayoutOutput>('jevLayout');
  const deferredRecord = recorder.stages.find(
    (record) => record.outcome === 'deferred',
  );
  const deferral = deferredRecord?.reason
    ? {
        stage: deferredRecord.stage,
        reason: deferredRecord.reason,
        provider:
          deferredRecord.reason.split('/')[1]?.startsWith('provider_') ?? false,
      }
    : undefined;
  const fill = actions && fillOf(actions, recorder.stages);
  const consumed: AnswerRecord[] = [
    ...(selection?.answers ?? []),
    ...(actions?.answers ?? []),
    ...(layout?.answers ?? []),
  ];
  return {
    ...(scenario.expected.status === 'deferred' && {
      deferredAsExpected:
        deferral !== undefined &&
        (scenario.expected.deferStage === undefined ||
          deferral.stage === scenario.expected.deferStage),
    }),
    ...(deferral && { deferral }),
    fallbackCalls,
    stageScores: {
      ...(selection && { selection: scoreSelection(scenario, selection) }),
      ...(actions && { actions: scoreActions(scenario, actions) }),
      ...(layout?.tree && {
        layout: scoreLayout(scenario, { tree: layout.tree }),
      }),
    },
    stages: recorder.stages.map(
      ({ input: _input, output: _output, ...rest }) => rest,
    ),
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
    jevCalls: recorder.calls,
    answers: recorder.calls.flatMap(flattenAnswers),
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

interface Turn {
  readonly ms: number;
  readonly response?: MaelstromResponse;
  readonly error?: { readonly tag: string; readonly message: string };
}

async function handle(
  options: EvalOptions,
  scenario: Scenario,
  repeat: number,
  arm: string,
  planner: Planner,
): Promise<Turn> {
  const withHistory: Planner = (input, ctx) =>
    planner(
      scenario.history ? { ...input, history: scenario.history } : input,
      ctx,
    );
  const engine = createEngine({
    planner: withHistory,
    retry: false,
    logger: options.logger ?? silent,
  });
  const started = performance.now();
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId(`eval-${arm}`),
      id: MessageId(`${scenario.id}-${arm}-${repeat}`),
      request: scenario.request,
    }),
  );
  const ms = performance.now() - started;
  if (isOk(result) && result.value.type === 'chart_response')
    return { ms, response: result.value.response };
  if (isOk(result))
    return {
      ms,
      error: { tag: 'UnexpectedOutput', message: result.value.type },
    };
  return {
    ms,
    error: { tag: result.error._tag, message: result.error.message },
  };
}

function base(
  scenario: Scenario,
  repeat: number,
  arm: Arm,
  turn: Turn,
): RunRecord {
  return {
    scenarioId: scenario.id,
    suite: scenario.suite,
    arm: arm.name,
    kind: arm.kind,
    repeat,
    turnMs: turn.ms,
    expectedDeferral: scenario.expected.status === 'deferred',
    arrangementRules: scenario.expected.arrangement !== undefined,
    ...(scenario.spatial !== undefined && { spatial: scenario.spatial }),
    ...(scenario.expected.actions !== undefined && {
      expectsActions: scenario.expected.actions.length > 0,
    }),
    ...(turn.response && {
      userMessage: turn.response.userMessage,
      tree:
        turn.response.layout.type === 'tiling' ? turn.response.layout.tree : [],
      executionPlan: turn.response.executionPlan,
      ...(turn.response.layout.type === 'tiling' && {
        instances: turn.response.layout.instances,
      }),
    }),
    ...(turn.error && { error: turn.error }),
  };
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
  const complete = stages.find((record) => record.stage === 'llmComplete');
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
