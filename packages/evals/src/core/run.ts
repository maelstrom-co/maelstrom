import {
  attachEngineTelemetry,
  createEngine,
  type Instrument,
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
  isOk,
  type MaelstromResponse,
  MessageId,
  SessionId,
  type VesselInstanceSnapshot,
} from '@maelstrom-co/protocol';
import type { TelemetryAttachment } from '@maelstrom-co/telemetry';
import type { AnyTextAdapter } from '@tanstack/ai';
import type { RegisteredArm } from './arms.js';
import {
  GRADER_VERSION,
  type GraderCall,
  type GraderRecord,
  gradeResponse,
} from './grader.js';
import {
  createRecorder,
  type StageRecord,
  type StageReplacements,
} from './instrument.js';
import {
  type JudgeRubric,
  judgeEvidence,
  judgeProvenance,
  validateJudgeSelection,
} from './judge.js';
import {
  type EvaluationJudgeResult,
  judgeFromGrader,
  judgeNotRun,
} from './judge-result.js';
import {
  createOperationalCollector,
  type OperationalTelemetry,
} from './operational-telemetry.js';
import {
  extendOwned,
  type Judge,
  type Phase,
  type PlannerEvalPlugin,
} from './plugin.js';
import {
  type ReplaySource,
  replayedStages,
  replayStage,
  verifyReplay,
  verifyReplayShape,
  writeStageFile,
} from './replay.js';
import {
  type EvaluationRun,
  type RunInvocation,
  runEvaluationRun,
} from './run-orchestration.js';
import type {
  EvaluationAdapter,
  EvaluationContext,
  EvaluationResult,
} from './runtime/evaluate.js';
import type { Scenario, Suite } from './scenarios.js';
import { type ArrangedScore, scoreResponse } from './score.js';
import { type LlmCall, type LlmRole, withUsage } from './usage-adapter.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

/**
 * One turn of one arm, as `records.json` keeps it. A staged arm's plugin
 * adds its own fields through `recordTurn`, which the index signature
 * admits; the named fields are the runner's own, and the runner throws when
 * a plugin names one.
 */
export interface RunRecord {
  readonly [field: string]: unknown;
  readonly scenarioId: string;
  readonly suite: Suite;
  /** The arm's registry name. */
  readonly arm: string;
  /** `baseline` for a baseline arm, else the arm's `kind` or its plugin's name. */
  readonly kind: string;
  readonly repeat: number;
  /** Wall time of `engine.handle` for the turn. */
  readonly turnMs: number;
  readonly userMessage?: string;
  readonly error?: { readonly tag: string; readonly message: string };
  /** The scenario expects a deferral; excluded from every arm's overall pass rate. */
  readonly expectedDeferral: boolean;
  /** The scenario declares arrangement rules. */
  readonly arrangementRules: boolean;
  /** The scenario's spatial tag, when it has one. */
  readonly spatial?: boolean;
  /** Whether the scenario expects any action, when it states its actions. */
  readonly expectsActions?: boolean;
  /** Overall score of the shipped response (planned scenarios only). */
  readonly score?: ArrangedScore;
  /** Staged arms only: whether it deferred at the expected phase (expected-deferral scenarios). */
  readonly deferredAsExpected?: boolean;
  readonly deferral?: {
    readonly stage: string;
    readonly reason: string;
    readonly provider: boolean;
  };
  readonly fallbackCalls?: number;
  readonly stages?: readonly Omit<StageRecord, 'input' | 'output'>[];
  /** Every LLM call of the turn, by role. */
  readonly llmCalls?: readonly LlmCall[];
  readonly tree?: readonly unknown[];
  /** The shipped execution plan; absent from records written before the grader. */
  readonly executionPlan?: readonly ActionExecution[];
  /** Every retained instance the shipped layout declares; absent from records written before the grader. */
  readonly instances?: readonly VesselInstanceSnapshot[];
  /** The judge's verdict on the shipped response (`--grader`), with its own calls. */
  readonly grader?: GraderRecord;
  /** Secondary verdict and coverage, independent of rule-based correctness. */
  readonly judge?: EvaluationJudgeResult;
  /** Finalized isolated Engine operational collection, separate from provider usage. */
  readonly operational?: OperationalTelemetry;
}

/** The fields of {@link RunRecord} the runner owns; no plugin's `recordTurn` may set one. */
export const RUN_RECORD_FIELDS = [
  'scenarioId',
  'suite',
  'arm',
  'kind',
  'repeat',
  'turnMs',
  'userMessage',
  'error',
  'expectedDeferral',
  'arrangementRules',
  'spatial',
  'expectsActions',
  'score',
  'deferredAsExpected',
  'deferral',
  'fallbackCalls',
  'stages',
  'llmCalls',
  'tree',
  'executionPlan',
  'instances',
  'grader',
  'judge',
  'operational',
] as const satisfies readonly (keyof RunRecord)[];

/** What {@link runEval} runs: the scenarios, the arms and how, and where the results go. */
export interface EvalOptions {
  readonly scenarios: readonly Scenario[];
  /** Run in this order for every scenario and repeat. */
  readonly arms: readonly RegisteredArm[];
  readonly repeats: number;
  /** Shared-lifecycle run identity; generated once when omitted. */
  readonly runId?: string;
  /** Finalized native-policy sample evidence, separate from the native report. */
  readonly onEvaluation?: (result: EvaluationResult<RunRecord>) => void;
  /** Native report writer dispatched by the shared run lifecycle after completion. */
  readonly report?: (
    run: EvaluationRun<RunRecord, RunRecord>,
  ) => void | Promise<void>;
  /** Text adapter behind every LLM role; each role gets its own recording wrapper. */
  readonly adapter: AnyTextAdapter;
  /** The planner staged arms fall back to, on the `fallback` role's adapter. */
  readonly fallback: (
    adapter: AnyTextAdapter,
  ) => Stage<Retryable<PlanningInput>, PlannerCandidate>;
  readonly logger?: Logger;
  /** Called after every turn, for progress output. */
  readonly onRecord?: (record: RunRecord) => void;
  /** Output directory; each staged turn's stage records are written under `<out>/stages/<arm>/`. */
  readonly out?: string;
  /** Grades every shipped response after the turn's latency is measured. */
  readonly judge?: Judge;
  /** Independent rubric selection; defaults to the native planner rubric. */
  readonly judgeRubric?: JudgeRubric;
  /** The phase through which every staged arm replays a recorded run instead of running live. */
  readonly replay?: {
    readonly source: ReplaySource;
    readonly through: string;
  };
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Runs every scenario `repeats` times through each arm and scores the
 * shipped response. Every arm plans through `createEngine` with history off
 * and `retry: false`, so the arms differ only in their pipelines.
 *
 * @throws {Error} Before any turn runs, when the plugin of a staged arm
 *   maps no stage to a scenario's `deferStage` phase (see
 *   {@link unmappedPhases}), or when `options.replay` did not record every
 *   scenario and repeat from the same request and history, or lacks fields
 *   an arm reads from a replayed stage.
 * @throws {Error} When a plugin's `recordTurn` sets a field the runner owns.
 */
export async function runEval(options: EvalOptions): Promise<RunRecord[]> {
  const run = await runEvaluationRun({
    runId: options.runId,
    policy: 'native:planner/v1',
    cases: options.scenarios,
    runtimes: options.arms,
    repeats: options.repeats,
    concurrency: 1,
    caseId: (scenario) => scenario.id,
    runtimeId: (_scenario, registered) => registered.arm.name,
    prepare: (scenario) => scenario,
    preflight() {
      validateJudgeSelection(options.judge, options.judgeRubric);
      const unmapped = unmappedPhases(options.arms, options.scenarios);
      if (unmapped.length > 0) throw new Error(unmapped.join('\n'));
      if (options.replay) {
        verifyReplay(options.replay.source, options.scenarios, options.repeats);
        verifyReplayShape(
          options.replay.source,
          options.scenarios,
          options.repeats,
          options.replay.through,
          options.arms.filter(isStaged),
        );
      }
    },
    invocation: (scenario, _prepared, registered) =>
      plannerInvocation(options, registered, scenario),
    onEvaluation: options.onEvaluation,
    onRecord: options.onRecord,
    report: options.report,
  });
  return [...run.records];
}

function plannerInvocation(
  options: EvalOptions,
  registered: RegisteredArm,
  scenario: Scenario,
): RunInvocation<RunRecord, RunRecord> {
  const turn = createPlannerTurn({
    scenario,
    arm: registered,
    runtime: options,
    policy: 'native',
    provenance:
      options.replay && isStaged(registered)
        ? `native:planner-replay/v1; through:${options.replay.through}; source:${options.replay.source.dir}`
        : 'native:planner/v1',
  });
  let context: EvaluationContext | undefined;
  return {
    adapter: {
      ...turn.adapter,
      preflight(current) {
        context = current;
        return turn.adapter.preflight?.(current);
      },
    },
    async finish(result) {
      const state = context && turn.states.get(context);
      if (state?.thrown) throw state.thrown.error;
      if (!result.observation)
        throw new Error(
          result.error?.message ?? 'Planner produced no observation',
        );
      const record = {
        ...result.observation,
        ...(result.operational && { operational: result.operational }),
      };
      return {
        ...record,
        judge: result.judge,
        ...(state?.grader && { grader: state.grader }),
      };
    },
  };
}

/**
 * One line per staged arm and scenario whose expected deferral phase the
 * arm's plugin maps to no stage; such a turn could never count as deferred
 * at the expected phase. Empty when every expectation can be judged.
 */
export function unmappedPhases(
  arms: readonly RegisteredArm[],
  scenarios: readonly Scenario[],
): readonly string[] {
  const problems: string[] = [];
  const plugins = [
    ...new Set(arms.filter(isStaged).map(({ plugin }) => plugin)),
  ];
  for (const plugin of plugins)
    for (const scenario of scenarios) {
      const phase = scenario.expected.deferStage;
      if (phase !== undefined && plugin.phases?.[phase] === undefined)
        problems.push(
          `plugin ${plugin.name} maps no stage to phase ${phase}, which scenario ${scenario.id} expects to defer at`,
        );
    }
  return problems;
}

/**
 * Grades one shipped response: `grader/not_tiling` for a non-tiling
 * layout, or `grader/exception: <message>` for any exception the judge or
 * the grading itself raises, logged with the error and keeping the judge
 * calls made before it. The grader is secondary and must never abort a run
 * or change a turn's primary result.
 */
export async function grade(
  judge: Judge,
  scenario: Scenario,
  response: MaelstromResponse,
  logger: Logger,
): Promise<GraderRecord> {
  const { layout } = response;
  if (layout.type !== 'tiling')
    return {
      graderVersion: GRADER_VERSION,
      verbalizerVersion: VERBALIZER_VERSION,
      failure: 'grader/not_tiling',
      calls: [],
    };
  const calls: GraderCall[] = [];
  try {
    return await gradeResponse(
      judge,
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
      calls,
    );
  } catch (error) {
    logger.error('grader threw', { scenario: scenario.id, error });
    return {
      graderVersion: GRADER_VERSION,
      verbalizerVersion: VERBALIZER_VERSION,
      failure: `grader/exception: ${describeError(error)}`,
      calls,
    };
  }
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause === undefined
    ? error.message
    : `${error.message} (cause: ${describeError(error.cause)})`;
}

function isStaged({ arm }: RegisteredArm): boolean {
  return arm.baseline !== true;
}

/** A turn's record, and the planned response to grade when it shipped one. */
async function runTurn(
  options: EvalOptions,
  registered: RegisteredArm,
  scenario: Scenario,
  repeat: number,
  collector: ReturnType<typeof createOperationalCollector>,
  attachments: TelemetryAttachment[],
): Promise<{ record: RunRecord; response?: MaelstromResponse }> {
  const { arm, plugin } = registered;
  const staged = isStaged(registered);
  const llmCalls: LlmCall[] = [];
  const adapter = (role: LlmRole) =>
    withUsage(options.adapter, role, (call) => llmCalls.push(call));
  const replay = staged ? options.replay : undefined;
  const replacements: StageReplacements = replay
    ? Object.fromEntries(
        replayedStages(plugin, replay.through).map((name) => [
          name,
          replayStage(name, replay.source.turn(scenario.id, repeat)),
        ]),
      )
    : {};
  const recorder = createRecorder(replacements);
  let fallbackCalls = 0;
  const fallback = options.fallback(adapter('fallback'));
  const counted: Stage<Retryable<PlanningInput>, PlannerCandidate> = (
    input,
    ctx,
  ) => {
    fallbackCalls += 1;
    return fallback(input, ctx);
  };
  const planner = arm.build({
    adapter,
    fallback: counted,
    onCall: recorder.onCall,
  });
  const turn = await handle(
    options,
    scenario,
    repeat,
    arm.name,
    planner,
    recorder.instrument,
    collector,
    attachments,
  );
  const owned: RunRecord = {
    ...base(scenario, repeat, registered, turn),
    llmCalls,
    ...(staged &&
      stagedFields(scenario, plugin, recorder.stages, fallbackCalls)),
    ...(turn.response &&
      scenario.expected.status === 'planned' && {
        score: scoreResponse(scenario, turn.response),
      }),
  };
  const extension =
    staged && plugin.recordTurn?.(scenario, recorder.stages, recorder.calls);
  const record: RunRecord = extension
    ? extendOwned(owned, extension, {
        plugin: plugin.name,
        where: 'a run record',
        reserved: RUN_RECORD_FIELDS,
      })
    : owned;
  if (staged && options.out !== undefined)
    await writeStageFile(options.out, {
      arm: arm.name,
      scenarioId: scenario.id,
      repeat,
      stages: recorder.stages,
    });
  return {
    record,
    ...(turn.response && { response: turn.response }),
  };
}

type PlannerTurnOptions = {
  readonly scenario: Scenario;
  readonly arm: RegisteredArm;
  readonly runtime: Pick<
    EvalOptions,
    | 'adapter'
    | 'fallback'
    | 'logger'
    | 'replay'
    | 'out'
    | 'judge'
    | 'judgeRubric'
  >;
  readonly provenance: string;
  readonly policy: 'native' | 'adapter';
};

/** Reusable planner adapter; native-only response/exception state is not exposed. */
export function plannerTurnAdapter(
  options: PlannerTurnOptions,
): EvaluationAdapter<RunRecord> {
  return createPlannerTurn(options).adapter;
}

function createPlannerTurn(options: PlannerTurnOptions) {
  const states = new WeakMap<
    EvaluationContext,
    {
      collector: ReturnType<typeof createOperationalCollector>;
      attachments: TelemetryAttachment[];
      response?: MaelstromResponse;
      grader?: GraderRecord;
      thrown?: { error: unknown };
    }
  >();
  const adapter: EvaluationAdapter<RunRecord> = {
    surface:
      options.policy === 'native' ? 'planner-native' : 'planner-response',
    provenance: options.provenance,
    preflight(context) {
      validateJudgeSelection(
        options.runtime.judge,
        options.runtime.judgeRubric,
      );
      const errors = unmappedPhases([options.arm], [options.scenario]);
      if (errors.length) throw new Error(errors.join('\n'));
      if (options.runtime.replay) {
        const { source, through } = options.runtime.replay;
        verifyReplay(source, [options.scenario], [context.identity.sample]);
        verifyReplayShape(
          source,
          [options.scenario],
          [context.identity.sample],
          through,
          [options.arm].filter(isStaged),
        );
      }
    },
    async execute(context) {
      const collector = createOperationalCollector('sample');
      const attachments: TelemetryAttachment[] = [];
      const state: {
        collector: typeof collector;
        attachments: TelemetryAttachment[];
        response?: MaelstromResponse;
        thrown?: { error: unknown };
      } = { collector, attachments };
      states.set(context, state);
      try {
        const turn = await runTurn(
          {
            ...options.runtime,
            scenarios: [options.scenario],
            arms: [options.arm],
            repeats: 1,
          },
          options.arm,
          options.scenario,
          context.identity.sample,
          collector,
          attachments,
        );
        state.response = turn.response;
        for (const stage of turn.record.stages ?? [])
          context.record({ kind: 'stage', value: stage });
        context.record({ kind: 'turn', value: turn.record });
        return {
          completeness: turn.record.error ? 'partial' : 'complete',
          disposition: turn.record.deferral ? 'deferred' : 'planned',
          value: turn.record,
          ...(turn.record.error && { error: turn.record.error.message }),
        };
      } catch (error) {
        state.thrown = { error };
        throw error;
      }
    },
    score(record) {
      if (record.expectedDeferral)
        return options.policy === 'native'
          ? { outcome: 'unscored', failures: [] }
          : {
              outcome: record.deferredAsExpected ? 'pass' : 'fail',
              failures: record.deferredAsExpected
                ? []
                : ['Expected planner deferral was not observed'],
            };
      if (!record.score)
        throw new Error('Planner record lacks correctness evidence');
      return {
        outcome: record.score.pass ? 'pass' : 'fail',
        failures: record.score.failures,
      };
    },
    ...(options.runtime.judge && {
      async judge(
        _result: EvaluationResult<RunRecord>,
        context: EvaluationContext,
      ) {
        const state = states.get(context);
        if (!state?.response) return judgeNotRun('no_valid_evidence');
        const judge = options.runtime.judge;
        if (!judge) return judgeNotRun('disabled');
        if (options.runtime.judgeRubric === 'legacy')
          return judgeEvidence(
            judge,
            'legacy_task',
            {
              request: options.scenario.request,
              history: options.scenario.history ?? [],
              expected: options.scenario.expected,
              output: state.response,
              assistantText: state.response.userMessage,
            },
            { logger: options.runtime.logger ?? silent },
          );
        state.grader = await grade(
          judge,
          options.scenario,
          state.response,
          options.runtime.logger ?? silent,
        );
        return judgeFromGrader(state.grader, judgeProvenance(judge));
      },
    }),
    async finalizeOperational(context) {
      const collection = states.get(context);
      if (!collection) throw new Error('Planner collection unavailable');
      return collection.collector.finalize(collection.attachments);
    },
  };
  return { adapter, states };
}

function stagedFields(
  scenario: Scenario,
  plugin: PlannerEvalPlugin,
  stages: readonly StageRecord[],
  fallbackCalls: number,
): Partial<RunRecord> {
  const deferredRecord = stages.find((record) => record.outcome === 'deferred');
  const deferral = deferredRecord?.reason
    ? {
        stage: deferredRecord.stage,
        reason: deferredRecord.reason,
        provider:
          deferredRecord.reason.split('/')[1]?.startsWith('provider_') ?? false,
      }
    : undefined;
  const phase: Phase | undefined = scenario.expected.deferStage;
  const expectedStage =
    phase === undefined ? undefined : plugin.phases?.[phase];
  return {
    ...(scenario.expected.status === 'deferred' && {
      deferredAsExpected:
        deferral !== undefined &&
        (scenario.expected.deferStage === undefined ||
          deferral.stage === expectedStage),
    }),
    ...(deferral && { deferral }),
    fallbackCalls,
    stages: stages.map(({ input: _input, output: _output, ...rest }) => rest),
  };
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
  instrument: Instrument,
  collector: ReturnType<typeof createOperationalCollector>,
  attachments: TelemetryAttachment[],
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
    instrument,
  });
  attachments.push(attachEngineTelemetry(engine, collector.telemetry));
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
  { arm, plugin }: RegisteredArm,
  turn: Turn,
): RunRecord {
  return {
    scenarioId: scenario.id,
    suite: scenario.suite,
    arm: arm.name,
    kind: arm.baseline ? 'baseline' : (arm.kind ?? plugin.name),
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
