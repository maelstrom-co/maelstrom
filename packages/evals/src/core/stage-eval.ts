import type { ParseArgsOptionDescriptor } from 'node:util';
import {
  isDeferred,
  type Logger,
  noopInstrument,
  type PlanningInput,
  type Stage,
  type StageContext,
} from '@maelstrom-co/engine';
import { isErr, MessageId, SessionId } from '@maelstrom-co/protocol';
import {
  type JudgeRubric,
  judgeEvidence,
  validateJudgeSelection,
} from './judge.js';
import { type EvaluationJudgeResult, judgeNotRun } from './judge-result.js';
import {
  createOperationalCollector,
  type OperationalTelemetry,
  unavailableOperationalTelemetry,
} from './operational-telemetry.js';
import type { Judge, ProviderCall } from './plugin.js';
import { type EvaluationRun, runEvaluationRun } from './run-orchestration.js';
import type {
  EvaluationAdapter,
  EvaluationContext,
  EvaluationResult,
} from './runtime/evaluate.js';
import type { Scenario, Suite } from './scenarios.js';

/**
 * How one stage turn ended: its output `pass`ed or `fail`ed the stage's
 * score, it `handed_off` the decision to a later stage (neither pass nor
 * fail), the stage `deferred` or returned an `error`, or the scenario could
 * not form the stage's input and nothing ran (`not_applicable`).
 */
export type StageOutcome =
  | 'pass'
  | 'fail'
  | 'handed_off'
  | 'deferred'
  | 'error'
  | 'not_applicable';

/** Every {@link StageOutcome}, in report order. */
export const STAGE_OUTCOMES: readonly StageOutcome[] = [
  'pass',
  'fail',
  'handed_off',
  'deferred',
  'error',
  'not_applicable',
];

/** What a stage's input builder made of one scenario. */
export type PreparedInput<Input> =
  | {
      readonly applicable: true;
      readonly input: Input;
      /** The planning input the stage's context carries as its origin. */
      readonly origin: PlanningInput;
    }
  | { readonly applicable: false; readonly reason: string };

/** A stage module's verdict on one stage output. */
export interface Judgement<Detail> {
  readonly outcome: 'pass' | 'fail' | 'handed_off';
  readonly failures: readonly string[];
  readonly detail: Detail;
}

/** An extra CLI option a stage module declares, as `parseArgs` takes it. */
export type CliFlag = ParseArgsOptionDescriptor;

/** What the CLI hands a module's `configure`: the flag values and the run they apply to. */
export interface StageEvalRun {
  readonly scenarios: readonly Scenario[];
  readonly repeats: number;
}

/** A module as `configure` returns it, with the settings to print in `meta.json`. */
export interface ConfiguredStageEval<Input, Output, Detail, Deps> {
  readonly module: StageEvalModule<Input, Output, Detail, Deps>;
  readonly meta: StageRunMeta;
}

/** The run's settings, printed at the top of the report. */
export type StageRunMeta = Readonly<Record<string, string | number | boolean>>;

/**
 * Everything the stage eval needs to test one pipeline stage on its own:
 * the variants to compare, what they depend on, the input each scenario
 * implies, how an output scores, and the stage-specific report sections.
 */
export interface StageEvalModule<Input, Output, Detail, Deps> {
  /** The `--stage` name that selects the module. */
  readonly name: string;
  /** The pipeline stage's name, recorded on every turn. */
  readonly stage: string;
  /** What the report calls the module's provider calls; `Provider` when absent. */
  readonly provider?: string;
  /** Environment variables the module needs; the CLI refuses to run without them. */
  readonly requiredEnv?: readonly string[];
  /** Stage factories by descriptive variant name, in report order. */
  readonly variants: Readonly<
    Record<string, (deps: Deps) => Stage<Input, Output>>
  >;
  /** The dependencies one turn's stage runs on, reporting every provider call to `onCall`. */
  makeDeps(onCall: (call: ProviderCall) => void): Deps;
  /** Extra CLI options, by flag name. */
  readonly flags?: Readonly<Record<string, CliFlag>>;
  /** The module the CLI runs given its flags, with the settings to print; the module itself when absent. */
  configure?(
    values: Readonly<Record<string, unknown>>,
    run: StageEvalRun,
  ): Promise<ConfiguredStageEval<Input, Output, Detail, Deps>>;
  /** The stage's input for `scenario`, or why the scenario cannot form it. */
  readonly prepare: (
    scenario: Scenario,
    ctx: StageContext,
  ) => Promise<PreparedInput<Input>>;
  /**
   * The input one turn runs on, from the scenario's prepared input, for a
   * module that varies part of it by repeat. The prepared input when absent.
   */
  readonly turnInput?: (
    scenario: Scenario,
    repeat: number,
    input: Input,
  ) => Input;
  /**
   * The deferral reason the stage should return for `scenario`, or
   * undefined when it should return an output. A turn of such a scenario
   * passes only when the stage defers with that reason; an output that
   * would pass is a fail, and a hand-off stays handed off.
   */
  readonly expectedDeferral?: (scenario: Scenario) => string | undefined;
  /** Scores one output of the stage against `scenario`. */
  readonly judge: (
    scenario: Scenario,
    input: Input,
    output: Output,
  ) => Judgement<Detail>;
  /** Report sections beyond the common rows, as Markdown blocks. */
  readonly reportSections?: (
    records: readonly StageTurnRecord<Detail>[],
    variants: readonly string[],
  ) => readonly string[];
}

/** One stage turn, as `records.json` keeps it. */
export interface StageTurnRecord<Detail = unknown> {
  readonly stage: string;
  readonly variant: string;
  readonly scenarioId: string;
  readonly suite: Suite;
  readonly repeat: number;
  readonly outcome: StageOutcome;
  /** Why a `fail` failed; empty otherwise. */
  readonly failures: readonly string[];
  /** The deferral reason, the error, or why the scenario is not applicable. */
  readonly reason?: string;
  /** Wall time of the stage call; absent when nothing ran. */
  readonly stageMs?: number;
  /** Every provider call the stage made, as the module's `makeDeps` reported it. */
  readonly calls: readonly ProviderCall[];
  /** The stage module's own record of the output; absent unless the stage returned one. */
  readonly detail?: Detail;
  /** The deferral reason the scenario expects of the stage; absent when it expects an output. */
  readonly expectedDeferral?: string;
  /** Finalized stage-owned collection; absence is not zero operations. */
  readonly operational?: OperationalTelemetry;
  /** Optional historical field; current runs always record a secondary judge status. */
  readonly judge?: EvaluationJudgeResult;
  /** Opt-in evidence of a completed stage whose judge threw, captured before judging. */
  readonly judgeFailure?: {
    /** Judge exception, not a runtime failure. */
    readonly message: string;
    /** Completed invocation's input snapshot. */
    readonly input: unknown;
    /** Completed invocation's output snapshot. */
    readonly output: unknown;
  };
}

/** Options for {@link runStageEval}. */
export interface StageEvalOptions {
  /** Optional LLM/heuristic provider, separate from module.judge deterministic assertions. */
  readonly judge?: Judge;
  /** Rubric choice independent of provider. */
  readonly judgeRubric?: JudgeRubric;
  /** Shared-lifecycle identity generated once when omitted. */
  readonly runId?: string;
  /** Native-policy finalized result for each stage invocation. */
  readonly onEvaluation?: (result: EvaluationResult<StageTurnRecord>) => void;
  /** Native report writer dispatched once by common run orchestration. */
  readonly report?: (
    run: EvaluationRun<StageTurnRecord, StageTurnRecord>,
  ) => void | Promise<void>;
  readonly scenarios: readonly Scenario[];
  /** Variant names of the module, run in this order for every scenario and repeat. */
  readonly variants: readonly string[];
  readonly repeats: number;
  /** Turns in flight at once. Defaults to 1. */
  readonly concurrency?: number;
  /** Preserve judge exceptions with completed evidence; by default they propagate. */
  readonly captureJudgeFailure?: boolean;
  readonly logger?: Logger;
  /** Called after every turn, for progress output. */
  readonly onRecord?: (record: StageTurnRecord) => void;
}

/**
 * A stage module with its types erased, so modules of different stages
 * share one registry.
 */
export interface RegisteredStageEval {
  readonly name: string;
  readonly stage: string;
  readonly provider?: string;
  readonly requiredEnv?: readonly string[];
  readonly variants: readonly string[];
  readonly flags?: Readonly<Record<string, CliFlag>>;
  configure(
    values: Readonly<Record<string, unknown>>,
    run: StageEvalRun,
  ): Promise<{
    readonly module: RegisteredStageEval;
    readonly meta: StageRunMeta;
  }>;
  /** One shared-lifecycle invocation, retaining its actual sample/repeat identifier. */
  readonly adapter: (options: {
    readonly scenario: Scenario;
    readonly variant: string;
    readonly provenance: string;
    readonly judge?: Judge;
    readonly judgeRubric?: JudgeRubric;
  }) => EvaluationAdapter<StageTurnRecord>;
  readonly run: (options: StageEvalOptions) => Promise<StageTurnRecord[]>;
  readonly reportSections: (
    records: readonly StageTurnRecord[],
    variants: readonly string[],
  ) => readonly string[];
}

/**
 * Runs every named variant of `module` on each applicable scenario, calling
 * the stage directly with the scenario's prepared input: no planner, no
 * replay and no LLM. A scenario whose input cannot be formed is recorded
 * once per variant as `not_applicable`, with repeat 1.
 *
 * @throws {Error} On a variant name the module does not declare.
 */
export async function runStageEval<Input, Output, Detail, Deps>(
  module: StageEvalModule<Input, Output, Detail, Deps>,
  options: StageEvalOptions,
): Promise<StageTurnRecord<Detail>[]> {
  const logger = options.logger ?? silentLogger;
  const run = await runEvaluationRun({
    runId: options.runId,
    policy: 'native:stage/v1',
    cases: options.scenarios,
    runtimes: options.variants,
    repeats: options.repeats,
    concurrency: options.concurrency,
    caseId: (scenario) => scenario.id,
    runtimeId: (_scenario, variant) => `${module.name}/${variant}`,
    preflight() {
      validateJudgeSelection(options.judge, options.judgeRubric);
      const unknown = options.variants.filter(
        (name) => !Object.hasOwn(module.variants, name),
      );
      if (unknown.length > 0)
        throw new Error(
          `unknown ${module.stage} variant ${unknown.join(', ')}; known variants: ${Object.keys(module.variants).join(', ')}`,
        );
    },
    prepare: (scenario) =>
      module.prepare(scenario, stageContext(planningInput(scenario), logger)),
    sampleCount: (prepared, repeats) => (prepared.applicable ? repeats : 1),
    invocation(scenario, prepared, variant) {
      const turn = createStageTurn(module, {
        scenario,
        prepared,
        variant,
        logger,
        provenance: 'native:stage/v1',
        judge: options.judge,
        judgeRubric: options.judgeRubric,
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
        finish(result) {
          const state = context && turn.states.get(context);
          if (!options.captureJudgeFailure && state?.judgeError)
            throw state.judgeError.error;
          if (!result.observation)
            throw new Error(
              result.error?.message ?? 'Stage produced no observation',
            );
          return {
            ...result.observation,
            judge: result.judge,
            ...(result.operational && { operational: result.operational }),
          };
        },
      };
    },
    onEvaluation: options.onEvaluation,
    onRecord: options.onRecord,
    report: options.report,
  });
  return [...run.records];
}

/** Erases `module`'s types for a registry of stage evals. */
export function registerStageEval<Input, Output, Detail, Deps>(
  module: StageEvalModule<Input, Output, Detail, Deps>,
): RegisteredStageEval {
  return {
    name: module.name,
    stage: module.stage,
    ...(module.provider !== undefined && { provider: module.provider }),
    ...(module.requiredEnv && { requiredEnv: module.requiredEnv }),
    variants: Object.keys(module.variants),
    ...(module.flags && { flags: module.flags }),
    configure: async (values, run) => {
      const configured = await module.configure?.(values, run);
      return configured === undefined
        ? { module: registerStageEval(module), meta: {} }
        : {
            module: registerStageEval(configured.module),
            meta: configured.meta,
          };
    },
    adapter: (options) => stageTurnAdapter(module, options),
    run: (options) => runStageEval(module, options),
    reportSections: (records, variants) =>
      module.reportSections?.(
        records as readonly StageTurnRecord<Detail>[],
        variants,
      ) ?? [],
  };
}

/** The planning input a scenario's turn starts from, with its history. */
export function planningInput(scenario: Scenario): PlanningInput {
  return {
    messageId: MessageId(`stage-eval-${scenario.id}`),
    sessionId: SessionId('stage-eval'),
    request: scenario.request,
    history: scenario.history ?? [],
  };
}

async function runTurn<Input, Output, Detail, Deps>(
  module: StageEvalModule<Input, Output, Detail, Deps>,
  logger: Logger,
  turn: {
    readonly variant: string;
    readonly scenario: Scenario;
    readonly repeat: number;
    readonly prepared: Extract<PreparedInput<Input>, { applicable: true }>;
    readonly captureJudgeFailure?: boolean;
    readonly collector?: ReturnType<typeof createOperationalCollector>;
    readonly onEvidence?: (evidence: Record<string, unknown>) => void;
  },
): Promise<StageTurnRecord<Detail>> {
  const { variant, scenario, repeat, prepared } = turn;
  const expectedDeferral = module.expectedDeferral?.(scenario);
  const own = {
    ...base(module.stage, variant, scenario, repeat),
    ...(expectedDeferral !== undefined && { expectedDeferral }),
  };
  const calls: ProviderCall[] = [];
  let input = prepared.input;
  let started = performance.now();
  let result: Awaited<ReturnType<Stage<Input, Output>>>;
  let invoked = false;
  try {
    input = module.turnInput?.(scenario, repeat, input) ?? input;
    const stage = module.variants[variant](
      module.makeDeps((call) => calls.push(call)),
    );
    turn.collector?.telemetry.record({
      operation: 'engine.stage',
      outcome: 'started',
    });
    invoked = true;
    started = performance.now();
    result = await stage(input, stageContext(prepared.origin, logger));
  } catch (error) {
    if (invoked)
      turn.collector?.telemetry.record({
        operation: 'engine.stage',
        outcome: 'failed',
        durationMs: performance.now() - started,
      });
    return {
      ...own,
      outcome: 'error',
      reason: error instanceof Error ? error.message : String(error),
      stageMs: performance.now() - started,
      calls,
    };
  }
  const stageMs = performance.now() - started;
  turn.collector?.telemetry.record({
    operation: 'engine.stage',
    outcome: isErr(result)
      ? isDeferred(result.error)
        ? 'skipped'
        : 'failed'
      : 'succeeded',
    durationMs: stageMs,
  });
  if (isErr(result)) {
    if (isDeferred(result.error))
      turn.onEvidence?.({ input, deferral: { reason: result.error.reason } });
  } else turn.onEvidence?.({ input, output: result.value });
  if (isErr(result)) {
    const { error } = result;
    const deferred = isDeferred(error);
    const reason = isDeferred(error)
      ? error.reason
      : `${error._tag}: ${error.message}`;
    return {
      ...own,
      outcome: !deferred
        ? 'error'
        : reason === expectedDeferral
          ? 'pass'
          : 'deferred',
      reason,
      stageMs,
      calls,
    };
  }
  const completed = turn.captureJudgeFailure
    ? structuredClone({ input, output: result.value })
    : undefined;
  let judgement: Judgement<Detail>;
  try {
    judgement = module.judge(scenario, input, result.value);
  } catch (error) {
    if (completed === undefined) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...own,
      outcome: 'error',
      reason: message,
      stageMs,
      calls,
      judgeFailure: { message, ...completed },
    };
  }
  const missedDeferral =
    expectedDeferral !== undefined && judgement.outcome === 'pass';
  return {
    ...own,
    outcome: missedDeferral ? 'fail' : judgement.outcome,
    failures: missedDeferral
      ? [`expected a deferral: ${expectedDeferral}`]
      : judgement.failures,
    stageMs,
    calls,
    detail: judgement.detail,
  };
}

type StageTurnOptions<Input> = {
  readonly judge?: Judge;
  readonly judgeRubric?: JudgeRubric;
  readonly scenario: Scenario;
  readonly variant: string;
  readonly provenance: string;
  readonly logger?: Logger;
  readonly prepared?: PreparedInput<Input>;
};

/** Reusable stage adapter; judge exceptions and inputs belong to each invocation context. */
export function stageTurnAdapter<Input, Output, Detail, Deps>(
  module: StageEvalModule<Input, Output, Detail, Deps>,
  options: StageTurnOptions<Input>,
): EvaluationAdapter<StageTurnRecord<Detail>> {
  return createStageTurn(module, options).adapter;
}

function createStageTurn<Input, Output, Detail, Deps>(
  module: StageEvalModule<Input, Output, Detail, Deps>,
  options: StageTurnOptions<Input>,
) {
  const logger = options.logger ?? silentLogger;
  const states = new WeakMap<
    EvaluationContext,
    {
      prepared: PreparedInput<Input>;
      collector?: ReturnType<typeof createOperationalCollector>;
      judgeError?: { error: unknown };
      evidence?: Record<string, unknown>;
      evidenceError?: boolean;
    }
  >();
  const adapter: EvaluationAdapter<StageTurnRecord<Detail>> = {
    surface: 'isolated-stage',
    provenance: options.provenance,
    async preflight(context) {
      validateJudgeSelection(options.judge, options.judgeRubric);
      if (!Object.hasOwn(module.variants, options.variant))
        throw new Error(`Unknown stage variant: ${options.variant}`);
      states.set(context, {
        prepared:
          options.prepared ??
          (await module.prepare(
            options.scenario,
            stageContext(planningInput(options.scenario), logger),
          )),
      });
    },
    async execute(context) {
      const state = states.get(context);
      if (!state) throw new Error('Stage input unavailable');
      const { prepared } = state;
      let record: StageTurnRecord<Detail>;
      if (!prepared.applicable)
        record = {
          ...base(
            module.stage,
            options.variant,
            options.scenario,
            context.identity.sample,
          ),
          outcome: 'not_applicable',
          reason: prepared.reason,
          calls: [],
        };
      else {
        const collector = createOperationalCollector('sample');
        state.collector = collector;
        record = await runTurn(
          {
            ...module,
            judge(...args) {
              try {
                return module.judge(...args);
              } catch (error) {
                state.judgeError = { error };
                throw error;
              }
            },
          },
          logger,
          {
            variant: options.variant,
            scenario: options.scenario,
            repeat: context.identity.sample,
            prepared,
            captureJudgeFailure: true,
            collector,
            ...(options.judge && {
              onEvidence: (evidence: Record<string, unknown>) => {
                try {
                  state.evidence = structuredClone(evidence);
                } catch {
                  state.evidenceError = true;
                }
              },
            }),
          },
        );
      }
      context.record({ kind: 'stage', value: record });
      const executionFailed =
        record.outcome === 'error' && !record.judgeFailure;
      return {
        completeness: executionFailed ? 'partial' : 'complete',
        disposition: record.judgeFailure
          ? 'planned'
          : record.outcome === 'not_applicable' ||
              record.outcome === 'handed_off'
            ? record.outcome
            : record.outcome === 'deferred' ||
                (record.expectedDeferral &&
                  record.reason === record.expectedDeferral)
              ? 'deferred'
              : 'planned',
        value: record,
        ...(executionFailed && { error: record.reason ?? 'Stage error' }),
      };
    },
    score(record) {
      if (record.judgeFailure) throw new Error(record.judgeFailure.message);
      return {
        outcome: record.outcome === 'pass' ? 'pass' : 'fail',
        failures: record.failures.length
          ? record.failures
          : record.outcome === 'pass'
            ? []
            : [record.reason ?? record.outcome],
      };
    },
    ...(options.judge && {
      async judge(
        _result: EvaluationResult<StageTurnRecord<Detail>>,
        context: EvaluationContext,
      ) {
        const state = states.get(context);
        if (state?.evidenceError)
          return {
            schemaVersion: 1 as const,
            status: 'failed' as const,
            reason: 'exception' as const,
          };
        const evidence = state?.evidence;
        if (!evidence) return judgeNotRun('no_valid_evidence');
        const judge = options.judge;
        if (!judge) return judgeNotRun('disabled');
        return judgeEvidence(
          judge,
          'stage_output',
          {
            stage: module.stage,
            request: options.scenario.request,
            history: options.scenario.history ?? [],
            expected: options.scenario.expected,
            ...evidence,
          },
          { logger },
        );
      },
    }),
    async finalizeOperational(context) {
      const collector = states.get(context)?.collector;
      return collector
        ? collector.finalize()
        : unavailableOperationalTelemetry();
    },
  };
  return { adapter, states };
}

function base(
  stage: string,
  variant: string,
  scenario: Scenario,
  repeat: number,
): Omit<StageTurnRecord<never>, 'outcome' | 'calls'> & {
  readonly failures: readonly string[];
} {
  return {
    stage,
    variant,
    scenarioId: scenario.id,
    suite: scenario.suite,
    repeat,
    failures: [],
  };
}

function stageContext(origin: PlanningInput, logger: Logger): StageContext {
  return {
    origin,
    logger,
    instrument: noopInstrument,
    validate: () => {
      throw new Error('the stage eval validates no candidate');
    },
  };
}

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
