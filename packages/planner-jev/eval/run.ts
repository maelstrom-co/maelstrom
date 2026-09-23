import {
  cancellationError,
  createEngine,
  type Logger,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
} from '@maelstrom-co/engine';
import {
  type ActionExecution,
  ChartRequestMessage,
  err,
  isOk,
  type MaelstromResponse,
  MessageId,
  SessionId,
  type TilingNode,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';

import type { JevCaller, StageName } from '../src/lib/defer.js';
import type { ComposedLayoutRecord } from '../src/lib/stages-experimental/layout-composed.js';
import type {
  LayoutSource,
  Selection2,
} from '../src/lib/stages-experimental/types.js';
import type { AnswerRecord, JevActionPlan } from '../src/lib/types.js';
import {
  type Ask,
  createTypeSafeClient,
  type JevCall,
} from '../src/lib/typesafe-client.js';
import { type Arm, type ArmKind, demoLlmPlanner } from './arms.js';
import { goldInputs } from './gold-inputs.js';
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
  /**
   * `layoutComposed` only: the gating route, the hand-off cause, every
   * answer by question kind and Instance, and the checked candidates with
   * the parts each dropped as empty.
   */
  readonly composition?: ComposedLayoutRecord;
}

/** How far `--stop-after` runs each Jev arm's pipeline. */
export type StopAfter = 'layout';

/** Every `--stop-after` value. */
export const STOP_AFTER: readonly StopAfter[] = ['layout'];

/**
 * What a stop-after-layout turn's layout stage decided: a `tree` it wrote,
 * a hand-off to the completion call (`handed_off`, neither pass nor fail),
 * or `no_decision` when a stage deferred or failed before a decision.
 */
export type LayoutOnlyOutcome = 'tree' | 'handed_off' | 'no_decision';

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
  /**
   * Overall score of the shipped response (planned scenarios only); under
   * stop-after-layout, the score of the layout stage's tree.
   */
  readonly score?: ArrangedScore;
  /** Stop-after-layout turns only. */
  readonly layoutOnly?: LayoutOnlyOutcome;
  /**
   * Gold-input runs only: why the scenario's expectation cannot form the
   * select and actions outputs. Nothing ran; the turn counts in no rate.
   */
  readonly notApplicable?: string;
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
  /**
   * Ends every turn after `jevLayout` and scores its tree: `llmComplete`
   * never runs, and a deferral makes no fallback call.
   */
  readonly stopAfter?: StopAfter;
  /**
   * Feeds every turn the select and actions outputs its scenario's
   * expectation implies (see {@link goldInputs}) in place of the live stages.
   */
  readonly goldInputs?: boolean;
}

/** The message of the error that ends a stop-after-layout turn. */
export const STOPPED_AFTER_LAYOUT = 'stopped after jevLayout';

/**
 * Checks that `options` combine: stop-after and gold inputs need stage-library
 * arms, since the baseline has no stages and the POC's stages read a
 * different shape, and gold inputs replace what a replay would.
 *
 * @throws {Error} Naming the conflicting option and arms.
 */
export function checkRunModes(
  options: Pick<EvalOptions, 'arms' | 'stopAfter' | 'goldInputs'> & {
    /** Any value stands for a replay. */
    readonly replay?: unknown;
  },
): void {
  if (options.goldInputs && options.replay)
    throw new Error('--gold-inputs and --replay-from cannot be combined');
  const modes = [
    ...(options.stopAfter ? [`--stop-after ${options.stopAfter}`] : []),
    ...(options.goldInputs ? ['--gold-inputs'] : []),
  ];
  const unsupported = options.arms.filter((arm) => arm.kind !== 'jev');
  if (modes.length > 0 && unsupported.length > 0)
    throw new Error(
      `${modes.join(' and ')} run only stage-library arms; remove ${unsupported.map((arm) => arm.name).join(', ')}`,
    );
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Runs every scenario `repeats` times through each arm and scores the
 * shipped response. Every arm plans through `createEngine` with history off
 * and `retry: false`: the baseline is the same once-retried LLM planner the
 * Jev arms fall back to, so the arms differ only in their pipelines.
 *
 * @throws {Error} Before any turn runs, when {@link checkRunModes} refuses
 *   the options, when `options.replay` did not record
 *   every scenario and repeat from the same request and history, or lacks
 *   fields an arm reads from a replayed stage.
 */
export async function runEval(options: EvalOptions): Promise<RunRecord[]> {
  checkRunModes(options);
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
  const gold =
    jev && options.goldInputs
      ? goldInputs(scenario, arm.replayShape ?? 'poc')
      : undefined;
  if (gold && !gold.applicable)
    return {
      record: {
        ...base(scenario, repeat, arm, { ms: 0 }),
        notApplicable: gold.reason,
      },
    };
  const replay = jev ? options.replay : undefined;
  const stopAfter = jev ? options.stopAfter : undefined;
  const replacements: StageReplacements = {
    ...(replay &&
      Object.fromEntries(
        replay.stages.map((name) => [
          name,
          replayStage(name, replay.source.turn(scenario.id, repeat)),
        ]),
      )),
    ...(gold?.applicable && gold.stages),
    ...(stopAfter && { llmComplete: stopTurn }),
  };
  const recorder = createRecorder(
    replacements,
    stopAfter ? ['llmComplete'] : [],
  );
  let fallbackCalls = 0;
  const fallback = demoLlmPlanner(adapter('fallback'));
  const counted: Stage<Retryable<PlanningInput>, PlannerCandidate> = (
    input,
    ctx,
  ) => {
    fallbackCalls += 1;
    return stopAfter ? stopTurn(input, ctx) : fallback(input, ctx);
  };
  const planner = arm.build({
    typesafe: { ...options.typesafe, onCall: recorder.onCall },
    adapter,
    fallback: counted,
    instrument: recorder.instrument,
  });
  const handled = await handle(options, scenario, repeat, arm.name, planner);
  const turn = stopAfter ? withoutStop(handled) : handled;
  const record = {
    ...base(scenario, repeat, arm, turn),
    llmCalls,
    ...(jev && jevFields(scenario, recorder, fallbackCalls)),
    ...(turn.response &&
      scenario.expected.status === 'planned' && {
        score: scoreResponse(scenario, turn.response),
      }),
    ...(stopAfter && layoutOnlyFields(scenario, recorder.stages)),
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

const stopTurn: Stage<unknown, never> = async () =>
  err(cancellationError(STOPPED_AFTER_LAYOUT, 'stop-after layout'));

/** The turn without the error that stopped it after `jevLayout`. */
function withoutStop(turn: Turn): Turn {
  return turn.error?.tag === 'CancellationError' &&
    turn.error.message === STOPPED_AFTER_LAYOUT
    ? { ms: turn.ms }
    : turn;
}

/** A stop-after-layout turn's outcome, and the layout stage's tree as the shipped one, scored. */
function layoutOnlyFields(
  scenario: Scenario,
  stages: readonly StageRecord[],
): Partial<RunRecord> {
  const layout = stages.find(
    (record) => record.stage === 'jevLayout' && record.outcome === 'ok',
  )?.output as LayoutOutput | undefined;
  if (layout === undefined) return { layoutOnly: 'no_decision' };
  if (layout.tree === undefined) return { layoutOnly: 'handed_off' };
  const score =
    scenario.expected.status === 'planned'
      ? scoreLayout(scenario, { tree: layout.tree })
      : undefined;
  return {
    layoutOnly: 'tree',
    tree: layout.tree,
    ...(score && { score }),
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
          ...(layout.composition && { composition: layout.composition }),
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
  readonly composition?: ComposedLayoutRecord;
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
