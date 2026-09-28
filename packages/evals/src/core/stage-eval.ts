import type { ParseArgsOptionDescriptor } from 'node:util';

import {
  isDeferred,
  type Logger,
  type PlanningInput,
  type Stage,
  type StageContext,
} from '@maelstrom-co/engine';
import { isErr, MessageId, SessionId } from '@maelstrom-co/protocol';
import type { ProviderCall } from './plugin.js';
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
}

/** Options for {@link runStageEval}. */
export interface StageEvalOptions {
  readonly scenarios: readonly Scenario[];
  /** Variant names of the module, run in this order for every scenario and repeat. */
  readonly variants: readonly string[];
  readonly repeats: number;
  /** Turns in flight at once. Defaults to 1. */
  readonly concurrency?: number;
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
  const unknown = options.variants.filter(
    (name) => !Object.hasOwn(module.variants, name),
  );
  if (unknown.length > 0)
    throw new Error(
      `unknown ${module.stage} variant ${unknown.join(', ')}; known variants: ${Object.keys(module.variants).join(', ')}`,
    );
  const logger = options.logger ?? silentLogger;
  const tasks: (() => Promise<StageTurnRecord<Detail>>)[] = [];
  for (const scenario of options.scenarios) {
    const origin = planningInput(scenario);
    const prepared = await module.prepare(
      scenario,
      stageContext(origin, logger),
    );
    if (!prepared.applicable) {
      for (const variant of options.variants)
        tasks.push(async () => ({
          ...base(module.stage, variant, scenario, 1),
          outcome: 'not_applicable',
          reason: prepared.reason,
          calls: [],
        }));
      continue;
    }
    for (let repeat = 1; repeat <= options.repeats; repeat++)
      for (const variant of options.variants)
        tasks.push(() =>
          runTurn(module, logger, {
            variant,
            scenario,
            repeat,
            prepared,
          }),
        );
  }
  return runPool(tasks, options.concurrency ?? 1, options.onRecord);
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
  try {
    input = module.turnInput?.(scenario, repeat, input) ?? input;
    const stage = module.variants[variant](
      module.makeDeps((call) => calls.push(call)),
    );
    started = performance.now();
    result = await stage(input, stageContext(prepared.origin, logger));
  } catch (error) {
    return {
      ...own,
      outcome: 'error',
      reason: error instanceof Error ? error.message : String(error),
      stageMs: performance.now() - started,
      calls,
    };
  }
  const stageMs = performance.now() - started;
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
  const judgement = module.judge(scenario, input, result.value);
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
    validate: () => {
      throw new Error('the stage eval validates no candidate');
    },
  };
}

async function runPool<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number,
  onResult?: (result: T) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      const result = await tasks[index]();
      results[index] = result;
      onResult?.(result);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.max(1, Math.min(concurrency, tasks.length)) },
      worker,
    ),
  );
  return results;
}

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
