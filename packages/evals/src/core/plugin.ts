import type {
  Planner,
  PlannerCandidate,
  PlanningInput,
  Retryable,
  Stage,
} from '@maelstrom-co/engine';
import type { AnyTextAdapter } from '@tanstack/ai';
import type { GraderContext } from './grader.js';
import type { StageRecord } from './instrument.js';
import type { JudgeProvenance } from './judge-result.js';
import type { ArmSummary } from './report.js';
import type { RunRecord } from './run.js';
import type { Scenario } from './scenarios.js';
import type { RegisteredStageEval } from './stage-eval.js';
import type { LlmRole } from './usage-adapter.js';

/** The planner-neutral phases a plugin maps to its own stages, in pipeline order. */
export const PHASES = ['select', 'actions', 'layout'] as const;

/**
 * A planner-neutral phase: where a scenario expects a deferral, and how far
 * `--replay-through` replays.
 */
export type Phase = (typeof PHASES)[number];

/** Whether `name` is one of the {@link PHASES}. */
export function isPhase(name: string): name is Phase {
  return (PHASES as readonly string[]).includes(name);
}

/**
 * What the runner needs of every call an arm's own provider client makes,
 * so the report can count calls, latency and tokens without knowing the
 * provider. A plugin's call type extends it with whatever else it records.
 */
export interface ProviderCall {
  readonly latencyMs: number;
  /** Absent when the provider reported no usage. */
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  /** How the call ended, when the client reports it. */
  readonly outcome?: string;
}

/** What the runner hands an arm for one turn. */
export interface ArmDeps<Call extends ProviderCall = ProviderCall> {
  /** The text adapter for one LLM role, recording that role's calls. */
  adapter(role: LlmRole): AnyTextAdapter;
  /** The fallback planner, counted by the runner; staged arms run it on a deferral. */
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
  /** Records one call of the arm's own provider client, for the plugin's `recordTurn`. */
  onCall(call: Call): void;
}

/** One planner the eval compares, registered by a plugin under a unique name. */
export interface Arm<Call extends ProviderCall = ProviderCall> {
  readonly name: string;
  /**
   * A reference arm: it records and replays no stages, is left out of every
   * staged metric, and the staged arms are paired against it. Its records
   * carry kind `baseline`.
   */
  readonly baseline?: boolean;
  /** The label the arm's records carry as `kind`; the plugin's name when absent. */
  readonly kind?: string;
  /** Environment variables the arm needs; the CLI refuses to run without them. */
  readonly requiredEnv?: readonly string[];
  /**
   * The planner for one turn. The runner records and replays the stages of
   * its pipelines through the Engine's `instrument`, under the names given
   * with the engine's `named`.
   */
  build(deps: ArmDeps<Call>): Planner;
}

/** One dimension a judge rates: the question and its levels, lowest first. */
export interface JudgeDimension {
  readonly name: string;
  readonly question: string;
  readonly levels: readonly string[];
}

/** What a judge rates: the response in words and the dimensions to score. */
export interface JudgeInput {
  readonly state: Readonly<Record<string, unknown>>;
  readonly dimensions: readonly JudgeDimension[];
}

/** One rated dimension: the level, fractional when the judge interpolates, and the probability of each level index. */
export interface JudgeAnswer {
  readonly score: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

/** Every dimension rated, or why the judge could not rate, with the calls it made either way. */
export type JudgeVerdict =
  | {
      readonly answers: Readonly<Record<string, JudgeAnswer>>;
      readonly calls: readonly ProviderCall[];
    }
  | { readonly failure: string; readonly calls: readonly ProviderCall[] };

/** Rates shipped responses for the grader; the grader never knows the provider behind it. */
export interface Judge {
  /** Identity of new judge calls, independent of the tested planner/provider. */
  readonly provenance?: JudgeProvenance;
  /** Environment variables the judge needs; the CLI refuses `--grader` without them. */
  readonly requiredEnv?: readonly string[];
  score(input: JudgeInput, ctx: GraderContext): Promise<JudgeVerdict>;
}

/** One row of a suite's table in `report.md`, with one cell per arm. */
export interface ReportRow {
  readonly label: string;
  /** Where the row goes among the runner's own rows; `outcomes` when absent. */
  readonly section?: 'outcomes' | 'latency' | 'tokens';
  /** The cell for one arm; `n/a` when the summary lacks what the row reads. */
  cell(summary: ArmSummary): string;
}

/**
 * Fields a plugin adds to one arm's summary. Top-level fields are added to
 * the summary; `latency` and `tokens` are merged into the summary's own.
 * None may name a field the runner already sets there.
 */
export interface ArmSummaryExtension {
  readonly [field: string]: unknown;
  readonly latency?: Readonly<Record<string, unknown>>;
  readonly tokens?: Readonly<Record<string, unknown>>;
}

/**
 * What a planner family gives the eval: its arms, and the optional seams
 * that let the runners record, replay, summarise and grade its turns
 * without knowing its stages. A plugin whose arms are all `baseline` needs
 * nothing beyond `arms`.
 */
export interface PlannerEvalPlugin<
  Call extends ProviderCall = ProviderCall,
  StageName extends string = string,
> {
  readonly name: string;
  readonly arms: readonly Arm<Call>[];
  /** Arm names run when `--arm` is not given; every plugin's defaults run together. */
  readonly defaultArms?: readonly string[];
  /** Other names `--arm` accepts, alias to arm name. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** The pipeline's stage names in order, as the arms name them with `named`. */
  readonly stageOrder?: readonly StageName[];
  /**
   * The stage of `stageOrder` each planner-neutral phase maps to, for the
   * scenarios' `deferStage` expectations and `--replay-through`. The arm
   * registry refuses a plugin that maps a phase to a stage outside
   * `stageOrder`, and the runner refuses a scenario whose `deferStage` the
   * plugin of a staged arm leaves unmapped.
   */
  readonly phases?: Partial<Readonly<Record<Phase, StageName>>>;
  /**
   * The stage of `stageOrder` whose output is the candidate the Engine
   * heals and ships. Grader validation reads its recorded output for a
   * record written before records carried the shipped plan; without it
   * such records of the plugin's arms are skipped. The arm registry
   * refuses a stage outside `stageOrder`.
   */
  readonly completionStage?: StageName;
  /** The planner staged arms fall back to; the CLI takes the first plugin that offers one. */
  fallback?(
    adapter: AnyTextAdapter,
  ): Stage<Retryable<PlanningInput>, PlannerCandidate>;
  /** Settings printed with the run's meta whenever one of the plugin's arms runs. */
  meta?(): Readonly<Record<string, unknown>>;
  /** What a replayed stage output lacks for `arm` to read it; empty when the arm can replay it. */
  verifyReplay?(record: StageRecord, arm: Arm<Call>): readonly string[];
  /**
   * Fields added to a staged turn's run record, from the stages recorded
   * and the calls the arm's client made. The runner throws when one names
   * a field of its own.
   */
  recordTurn?(
    scenario: Scenario,
    stages: readonly StageRecord[],
    calls: readonly Call[],
  ): Readonly<Record<string, unknown>>;
  /**
   * Fields added to one staged arm's summary over its records. The report
   * throws when one names a field of its own, top level or within
   * `latency` or `tokens`.
   */
  summarizeArm?(records: readonly RunRecord[]): ArmSummaryExtension;
  /** Rows added to a suite's table for the arms in it, each cell reading one arm's summary. */
  reportRows?(summaries: readonly ArmSummary[]): readonly ReportRow[];
  /** Rates shipped responses for `--grader`; the CLI takes the first plugin that offers one. */
  readonly judge?: Judge;
  /** Single-stage evals the stage eval CLI offers under `--stage`. */
  readonly stageModules?: readonly RegisteredStageEval[];
}

/**
 * `owned` with a plugin's `extension` added. `reserved` names the fields the
 * runner owns whether or not `owned` sets them this time.
 *
 * @throws {Error} When `extension` names a field of `owned` or of `reserved`,
 *   naming `plugin`, `where` and every such field.
 */
export function extendOwned<T extends object>(
  owned: T,
  extension: Readonly<Record<string, unknown>>,
  context: {
    readonly plugin: string;
    readonly where: string;
    readonly reserved?: readonly string[];
  },
): T & Readonly<Record<string, unknown>> {
  const taken = new Set([...Object.keys(owned), ...(context.reserved ?? [])]);
  const collisions = Object.keys(extension).filter((key) => taken.has(key));
  if (collisions.length > 0)
    throw new Error(
      `plugin ${context.plugin} sets ${collisions.join(', ')} in ${context.where}, which the runner owns`,
    );
  return { ...owned, ...extension };
}
