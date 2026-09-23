import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  parseTilingSplitToken,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';

import { STAGE_NAMES } from '../src/lib/defer.js';
import type {
  ComposedAnswers,
  ComposedHandOff,
  ComposedLayoutRecord,
  ComposedRoute,
} from '../src/lib/stages-experimental/layout-composed.js';
import {
  PARTS,
  POSITIONS,
} from '../src/lib/stages-experimental/layout-composed-tree.js';
import type { ArmKind } from './arms.js';
import { GRADER_DIMENSIONS, type GraderDimension } from './grader.js';
import { type GraderValidation, graderGate } from './grader-validate.js';
import type { RunRecord } from './run.js';
import type { Scenario, Suite } from './scenarios.js';
import { LLM_ROLES, type LlmCall } from './usage-adapter.js';

export interface Ratio {
  readonly count: number;
  readonly total: number;
}

export interface Percentiles {
  readonly p50: number | undefined;
  readonly p95: number | undefined;
  readonly samples: number;
}

export interface TokenTotals {
  readonly calls: number;
  readonly input: number;
  readonly output: number;
  /** Calls that reported no usage, counted as zero tokens in `input` and `output`. */
  readonly withoutUsage: number;
}

/** How often a yes/no gate answered wrongly. */
export interface GateErrors {
  /** Yes where the answer should be no, over turns whose answer should be no. */
  readonly falsePositives: Ratio;
  /** No where the answer should be yes, over turns whose answer should be yes. */
  readonly falseNegatives: Ratio;
}

/** A route's turns and the share of them that made a Jev call. */
export interface ComposedRouteSummary {
  readonly turns: Ratio;
  readonly calls: Ratio;
}

/** Which composed-layout question a failed turn's Jev answers first diverge from the reference tree on. */
export type AttributionQuestion = 'shape' | 'placement' | 'position' | 'size';

/**
 * Whether {@link ComposedSummary.nudgedOrderKept} could be computed for at
 * least one nudged turn; `false` when no scenario was joined to a record, so
 * the request's current tree was unavailable.
 */
export type NudgedOrderKept =
  | { readonly derivable: true; readonly ratio: Ratio }
  | { readonly derivable: false; readonly reason: string };

/**
 * `layoutComposed` stage stats for one arm, built from every turn whose
 * record carries a {@link ComposedLayoutRecord}.
 */
export interface ComposedSummary {
  /** Turns with a recorded composition; the denominator of {@link routes} and {@link calls}. */
  readonly turns: number;
  readonly routes: Readonly<Record<ComposedRoute, ComposedRouteSummary>>;
  readonly calls: Ratio;
  readonly handOff: {
    /** Over turns that called Jev. */
    readonly rate: Ratio;
    readonly byCause: Readonly<Record<ComposedHandOff, number>>;
  };
  /** Over turns whose composition chose a candidate. */
  readonly repairs: {
    readonly droppedParts: Ratio;
    readonly addedParts: Ratio;
  };
  /** `counts[i]` is how often the candidate at rank `i` was chosen; `total` is every chosen turn. */
  readonly chosenIndex: {
    readonly counts: readonly number[];
    readonly total: number;
  };
  /**
   * Failed-arrangement turns whose scenario has a reference tree: how many
   * attribute to a question (see {@link attributeFailure}), and the count
   * per question.
   */
  readonly attribution: {
    readonly attributed: Ratio;
    readonly byQuestion: Readonly<Record<AttributionQuestion, number>>;
  };
  /** Nudged turns only: whether the pre-existing Instances kept their relative order. */
  readonly nudgedOrderKept: NudgedOrderKept;
}

/** The grader's verdicts on one arm's planned turns; secondary to the rule-based pass. */
export interface GraderSummary {
  /** Planned turns the grader scored. */
  readonly graded: number;
  /** Planned turns whose grading failed; they count in no mean. */
  readonly failed: number;
  /** Mean normalised score per dimension; `undefined` without a graded turn. */
  readonly mean: Readonly<Record<GraderDimension, number | undefined>>;
  /**
   * Mean of this arm's score minus the baseline's on the same scenario and
   * repeat, over the pairs where both were graded. Absent for the baseline.
   */
  readonly versusBaseline?: Readonly<
    Record<
      GraderDimension,
      { readonly mean: number | undefined; readonly pairs: number }
    >
  >;
  /** The grader's own TypeSafe usage, never part of the arm's planner cost. */
  readonly tokens: TokenTotals;
}

export interface ArmSummary {
  readonly arm: string;
  readonly kind: ArmKind;
  readonly suite: Suite | 'all';
  readonly runs: number;
  /** Shipped responses that pass, over planned scenarios (expected deferrals excluded). */
  readonly overall: Ratio;
  /**
   * Arrangement rules passed, over planned turns whose scenario declares
   * rules; an errored or unscored turn counts as a failure.
   */
  readonly arrangement: Ratio;
  readonly errors: number;
  /** Turns tagged spatial and non-spatial controls, the denominators of a spatial gate's error rates. */
  readonly spatial: { readonly spatial: number; readonly controls: number };
  /**
   * Gate errors over the turns whose live select call answered the gate:
   * `needsActions` against whether the scenario expects actions, `spatial`
   * against its spatial tag. Absent when no turn answered a gate.
   */
  readonly gates?: {
    readonly needsActions: GateErrors;
    readonly spatial: GateErrors;
  };
  /** Turns that ran or replayed a `jevLayout` stage, over planned turns whose scenario declares arrangement rules. */
  readonly arrangementReachedLayout?: Ratio;
  /**
   * Jev arms only: planned turns no stage deferred, their pass rate, and
   * wins and losses against the baseline on the same scenario and repeat.
   */
  readonly decisive?: {
    readonly pass: Ratio;
    readonly wins: number;
    readonly losses: number;
    readonly paired: number;
  };
  /** Jev arms only: expected-deferral scenarios that deferred at the expected stage. */
  readonly expectedDeferrals?: Ratio;
  readonly stages?: {
    readonly selection: Ratio;
    readonly actions: Ratio;
    readonly layout: Ratio;
  };
  /**
   * Jev arms only: runs that fell back, by full `<stage>/<code>` reason and
   * by stage. `byStage` leaves out `provider_*` deferrals, which are counted
   * in `providerByStage`.
   */
  readonly fallbacks?: {
    readonly total: Ratio;
    readonly byReason: Readonly<Record<string, number>>;
    readonly byStage: Readonly<Record<string, number>>;
    readonly providerByStage: Readonly<Record<string, number>>;
  };
  /** Jev arms only: filled stated_elsewhere slots over all such slots. */
  readonly fill?: Ratio;
  /**
   * Stop-after-layout runs only, over planned turns: hand-offs to the
   * completion call, which neither pass nor fail, and the pass rate over
   * every turn and over the turns whose layout stage wrote a tree.
   */
  readonly layoutOnly?: {
    readonly handedOff: Ratio;
    readonly passOverAll: Ratio;
    readonly passOverTrees: Ratio;
  };
  /** Gold-input runs only: turns whose scenario could not form gold inputs; they count in no other field. */
  readonly notApplicable?: number;
  /** Jev arms only: present when any turn recorded a `layoutComposed` composition. */
  readonly composed?: ComposedSummary;
  /** Stages replayed from a recorded run; their latency is left out. */
  readonly replayed: readonly string[];
  /** Present when any of the arm's turns was graded. */
  readonly grader?: GraderSummary;
  readonly latency: {
    readonly turn: Percentiles;
    /** Live stage runs only. */
    readonly stages?: Readonly<Record<string, Percentiles>>;
    readonly jevCall?: Percentiles;
    readonly llmCall: Readonly<Record<string, Percentiles>>;
  };
  readonly tokens: {
    readonly jev?: TokenTotals & {
      /** Mean TypeSafe tokens per turn. */
      readonly perTurn: { readonly input: number; readonly output: number };
    };
    readonly llm: TokenTotals & {
      readonly byRole: Readonly<Record<string, TokenTotals>>;
    };
  };
}

/** Nearest-rank percentile; `undefined` without samples. */
export function percentile(
  values: readonly number[],
  p: number,
): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * One summary per arm and suite present, plus `all` per arm, arms in the
 * order records name them. `scenarios` joins each record to its reference
 * tree and request by `scenarioId`, for the composed-layout section; omit it
 * where that join is unavailable (see {@link ComposedSummary.nudgedOrderKept}).
 */
export function summarize(
  records: readonly RunRecord[],
  scenarios: readonly Scenario[] = [],
): ArmSummary[] {
  const scenarioById = new Map(
    scenarios.map((scenario) => [scenario.id, scenario]),
  );
  const summaries: ArmSummary[] = [];
  const arms = [...new Set(records.map((record) => record.arm))];
  const suites = [...new Set(records.map((record) => record.suite))];
  for (const arm of arms)
    for (const suite of [...suites, 'all'] as const) {
      const inSuite = (record: RunRecord) =>
        suite === 'all' || record.suite === suite;
      const all = records.filter(
        (record) => record.arm === arm && inSuite(record),
      );
      const subset = all.filter((record) => record.notApplicable === undefined);
      const notApplicable = all.length - subset.length;
      if (subset.length > 0)
        summaries.push({
          ...summarizeArm(
            suite,
            subset,
            records.filter(
              (record) => record.kind === 'baseline' && inSuite(record),
            ),
            scenarioById,
          ),
          ...(notApplicable > 0 && { notApplicable }),
        });
    }
  return summaries;
}

/**
 * A Markdown report with the arms side by side, per suite. When any turn
 * was graded, the grader's rows appear only if `graderValidation` passes
 * {@link graderGate}; otherwise one line says the grader is unvalidated.
 */
export function renderMarkdown(
  summaries: readonly ArmSummary[],
  meta: Readonly<Record<string, unknown>>,
  graderValidation?: GraderValidation,
): string {
  const lines = ['# planner-jev eval', ''];
  for (const [key, value] of Object.entries(meta))
    lines.push(
      `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    );
  const gate = summaries.some((summary) => summary.grader !== undefined)
    ? graderGate(graderValidation)
    : undefined;
  if (gate) lines.push('', gate.line);
  const suites = [...new Set(summaries.map((summary) => summary.suite))];
  for (const suite of suites) {
    const rows = summaries.filter((summary) => summary.suite === suite);
    lines.push('', `## ${suite}`, '');
    lines.push(`| Metric | ${rows.map((row) => row.arm).join(' | ')} |`);
    lines.push(`| --- | ${rows.map(() => '---').join(' | ')} |`);
    const row = (label: string, cell: (summary: ArmSummary) => string) =>
      lines.push(`| ${label} | ${rows.map(cell).join(' | ')} |`);
    row('Runs', (s) => String(s.runs));
    if (rows.some((s) => s.notApplicable !== undefined))
      row('Gold inputs not applicable (not run)', (s) =>
        String(s.notApplicable ?? 0),
      );
    row('Overall pass', (s) => ratio(s.overall));
    if (rows.some((s) => s.layoutOnly !== undefined)) {
      row('Layout-only hand-offs to the LLM', (s) =>
        s.layoutOnly ? ratio(s.layoutOnly.handedOff) : 'n/a',
      );
      row('Layout-only pass over all planned turns', (s) =>
        s.layoutOnly ? ratio(s.layoutOnly.passOverAll) : 'n/a',
      );
      row('Layout-only pass over tree-producing turns', (s) =>
        s.layoutOnly ? ratio(s.layoutOnly.passOverTrees) : 'n/a',
      );
    }
    row('Arrangement pass', (s) => ratio(s.arrangement));
    row('Errors', (s) => String(s.errors));
    row('Decisive turns pass', (s) =>
      s.decisive ? ratio(s.decisive.pass) : 'n/a',
    );
    row('Decisive wins / losses vs baseline (paired)', (s) =>
      s.decisive
        ? `${s.decisive.wins} / ${s.decisive.losses} (${s.decisive.paired})`
        : 'n/a',
    );
    row('Expected deferrals at the right stage', (s) =>
      s.expectedDeferrals ? ratio(s.expectedDeferrals) : 'n/a',
    );
    row('Selection accuracy', (s) =>
      s.stages ? ratio(s.stages.selection) : 'n/a',
    );
    row('Actions accuracy', (s) =>
      s.stages ? ratio(s.stages.actions) : 'n/a',
    );
    row('Layout accuracy', (s) => (s.stages ? ratio(s.stages.layout) : 'n/a'));
    row('Fallback rate', (s) =>
      s.fallbacks ? ratio(s.fallbacks.total) : 'n/a',
    );
    const reasons = [
      ...new Set(rows.flatMap((s) => Object.keys(s.fallbacks?.byReason ?? {}))),
    ].sort();
    for (const reason of reasons)
      row(`Fallbacks: ${reason}`, (s) =>
        s.fallbacks ? String(s.fallbacks.byReason[reason] ?? 0) : 'n/a',
      );
    row('llmComplete fill rate', (s) => (s.fill ? ratio(s.fill) : 'n/a'));
    row('needsActions gate false positives / negatives', (s) =>
      s.gates ? gateErrors(s.gates.needsActions) : 'n/a',
    );
    row('Spatial gate false positives / negatives', (s) =>
      s.gates
        ? gateErrors(s.gates.spatial)
        : `n/a (${s.spatial.spatial} spatial, ${s.spatial.controls} controls)`,
    );
    row('Arrangement turns reaching jevLayout', (s) =>
      s.arrangementReachedLayout ? ratio(s.arrangementReachedLayout) : 'n/a',
    );
    if (rows.some((s) => s.composed !== undefined)) renderComposed(row);
    row('Replayed stages', (s) =>
      s.replayed.length > 0 ? s.replayed.join(', ') : 'none',
    );
    row('Turn latency p50 / p95 (ms)', (s) => spread(s.latency.turn));
    for (const stage of STAGE_NAMES)
      row(`${stage} latency p50 / p95 (ms)`, (s) => {
        const live = s.latency.stages?.[stage];
        if (live && live.samples > 0) return spread(live);
        return s.replayed.includes(stage) ? 'replayed' : 'n/a';
      });
    row('Jev call latency p50 / p95 (ms)', (s) =>
      s.latency.jevCall ? spread(s.latency.jevCall) : 'n/a',
    );
    const roles = LLM_ROLES.filter((role) =>
      rows.some((s) => s.tokens.llm.byRole[role] !== undefined),
    );
    for (const role of roles)
      row(`LLM ${role} call latency p50 / p95 (ms)`, (s) =>
        s.latency.llmCall[role] ? spread(s.latency.llmCall[role]) : 'n/a',
      );
    row('Jev calls / input / output tokens', (s) =>
      s.tokens.jev ? totals(s.tokens.jev) : 'n/a',
    );
    row('Jev calls per turn', (s) =>
      s.tokens.jev ? (s.tokens.jev.calls / s.runs).toFixed(2) : 'n/a',
    );
    row('Jev tokens per turn (input / output)', (s) =>
      s.tokens.jev
        ? `${s.tokens.jev.perTurn.input.toFixed(1)} / ${s.tokens.jev.perTurn.output.toFixed(1)}`
        : 'n/a',
    );
    row('LLM calls / input / output tokens', (s) => totals(s.tokens.llm));
    for (const role of roles)
      row(`LLM ${role} calls / input / output tokens`, (s) =>
        totals(
          s.tokens.llm.byRole[role] ?? {
            calls: 0,
            input: 0,
            output: 0,
            withoutUsage: 0,
          },
        ),
      );
    if (gate?.validated) {
      for (const dimension of GRADER_DIMENSIONS) {
        row(`Grader ${dimension} mean`, (s) =>
          fixed(s.grader?.mean[dimension]),
        );
        row(`Grader ${dimension} vs baseline (paired)`, (s) => {
          const paired = s.grader?.versusBaseline?.[dimension];
          return paired?.mean === undefined
            ? 'n/a'
            : `${paired.mean >= 0 ? '+' : ''}${paired.mean.toFixed(3)} (${paired.pairs})`;
        });
      }
      row('Grader failures', (s) =>
        s.grader
          ? ratio({
              count: s.grader.failed,
              total: s.grader.graded + s.grader.failed,
            })
          : 'n/a',
      );
      row('Grader calls / input / output tokens', (s) =>
        s.grader ? totals(s.grader.tokens) : 'n/a',
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Every planned scenario and repeat where the arms disagree on pass, with
 * each arm's outcome and failure strings.
 */
export function renderPaired(records: readonly RunRecord[]): string {
  const lines = ['# Paired disagreements', ''];
  const turns = new Map<string, RunRecord[]>();
  for (const record of records) {
    if (record.expectedDeferral || record.notApplicable !== undefined) continue;
    const key = `${record.scenarioId} #${record.repeat} (${record.suite})`;
    turns.set(key, [...(turns.get(key) ?? []), record]);
  }
  for (const [key, group] of turns) {
    const verdicts = new Set(group.map(verdict));
    if (verdicts.size < 2) continue;
    lines.push(`## ${key}`, '');
    for (const record of group) {
      const fallback = record.deferral
        ? ` (fallback ${record.deferral.reason})`
        : '';
      const outcome = record.error
        ? `error ${record.error.tag}: ${record.error.message}`
        : `${verdict(record)}${fallback}`;
      lines.push(`- ${record.arm}: ${outcome}`);
      for (const failure of record.score?.failures ?? [])
        lines.push(`  - ${failure}`);
    }
    lines.push('');
  }
  if (lines.length === 2)
    lines.push('No scenario where arms disagree on pass.');
  return `${lines.join('\n')}\n`;
}

/**
 * Writes `records.json`, `summary.json`, `report.md` and `paired.md` to
 * `out`; `graderValidation` decides whether the grader's rows appear, and
 * `scenarios` (see {@link summarize}) fills the composed-layout section.
 */
export async function writeReport(
  out: string,
  records: readonly RunRecord[],
  meta: Readonly<Record<string, unknown>>,
  graderValidation?: GraderValidation,
  scenarios: readonly Scenario[] = [],
): Promise<ArmSummary[]> {
  const summaries = summarize(records, scenarios);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'records.json'), JSON.stringify(records, null, 2));
  await writeFile(
    join(out, 'summary.json'),
    JSON.stringify(
      {
        meta,
        summaries,
        ...(graderValidation && { graderValidation }),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(out, 'report.md'),
    renderMarkdown(summaries, meta, graderValidation),
  );
  await writeFile(join(out, 'paired.md'), renderPaired(records));
  return summaries;
}

function summarizeArm(
  suite: Suite | 'all',
  records: readonly RunRecord[],
  baselines: readonly RunRecord[],
  scenarioById: ReadonlyMap<string, Scenario>,
): ArmSummary {
  const [first] = records;
  const arm = first?.arm ?? '';
  const kind = first?.kind ?? 'baseline';
  const planned = records.filter((record) => !record.expectedDeferral);
  const passed = (subset: readonly RunRecord[]) => ({
    count: subset.filter((record) => record.score?.pass === true).length,
    total: subset.length,
  });
  const ruled = planned.filter((record) => record.arrangementRules);
  const llmCalls = records.flatMap((record) => record.llmCalls ?? []);
  const common = {
    arm,
    kind,
    suite,
    runs: records.length,
    overall: passed(planned),
    arrangement: {
      count: ruled.filter((record) => record.score?.arrangement?.pass === true)
        .length,
      total: ruled.length,
    },
    errors: records.filter((record) => record.error !== undefined).length,
    spatial: {
      spatial: records.filter((record) => record.spatial === true).length,
      controls: records.filter((record) => record.spatial === false).length,
    },
    replayed: [
      ...new Set(
        records.flatMap((record) =>
          (record.stages ?? [])
            .filter((entry) => entry.replayed)
            .map((entry) => entry.stage),
        ),
      ),
    ],
  };
  if (records.some((record) => record.layoutOnly !== undefined)) {
    const trees = planned.filter((record) => record.layoutOnly === 'tree');
    Object.assign(common, {
      layoutOnly: {
        handedOff: {
          count: planned.filter((record) => record.layoutOnly === 'handed_off')
            .length,
          total: planned.length,
        },
        passOverAll: passed(planned),
        passOverTrees: passed(trees),
      },
    });
  }
  const grader = graderSummary(
    planned,
    kind === 'baseline' ? undefined : baselines,
  );
  if (grader) Object.assign(common, { grader });
  const llm = {
    llmCall: Object.fromEntries(
      LLM_ROLES.flatMap((role) => {
        const calls = llmCalls.filter((call) => call.role === role);
        return calls.length > 0
          ? [[role, spreadOf(calls.map((call) => call.latencyMs))]]
          : [];
      }),
    ),
    tokens: llmTotals(llmCalls),
  };
  if (kind === 'baseline')
    return {
      ...common,
      latency: {
        turn: spreadOf(records.map((record) => record.turnMs)),
        llmCall: llm.llmCall,
      },
      tokens: { llm: llm.tokens },
    };

  const stageRatio = (key: 'selection' | 'actions' | 'layout') => {
    const scored = records.flatMap((record) => {
      const score = record.stageScores?.[key];
      return score ? [score] : [];
    });
    return {
      count: scored.filter((score) => score.pass).length,
      total: scored.length,
    };
  };
  const byReason: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  const providerByStage: Record<string, number> = {};
  for (const record of records) {
    if (!record.deferral) continue;
    byReason[record.deferral.reason] =
      (byReason[record.deferral.reason] ?? 0) + 1;
    const bucket = record.deferral.provider ? providerByStage : byStage;
    bucket[record.deferral.stage] = (bucket[record.deferral.stage] ?? 0) + 1;
  }
  const decisive = planned.filter(
    (record) =>
      record.deferral === undefined &&
      record.error === undefined &&
      record.score !== undefined,
  );
  let wins = 0;
  let losses = 0;
  let paired = 0;
  for (const record of decisive) {
    const other = baselines.find(
      (candidate) =>
        candidate.scenarioId === record.scenarioId &&
        candidate.repeat === record.repeat &&
        candidate.score !== undefined,
    );
    if (other?.score === undefined || record.score === undefined) continue;
    paired += 1;
    if (record.score.pass && !other.score.pass) wins += 1;
    if (!record.score.pass && other.score.pass) losses += 1;
  }
  const expected = records.filter((record) => record.expectedDeferral);
  const calls = records.flatMap((record) => record.jevCalls ?? []);
  const stageMs: Record<string, Percentiles> = {};
  for (const stage of STAGE_NAMES)
    stageMs[stage] = spreadOf(
      records.flatMap((record) =>
        (record.stages ?? [])
          .filter((entry) => entry.stage === stage && !entry.replayed)
          .map((entry) => entry.ms),
      ),
    );
  const jev = sum(calls);
  const gates = gateSummary(records);
  const composed = composedSummaryOf(records, scenarioById);
  return {
    ...common,
    ...(gates && { gates }),
    ...(composed && { composed }),
    arrangementReachedLayout: {
      count: ruled.filter((record) =>
        (record.stages ?? []).some((entry) => entry.stage === 'jevLayout'),
      ).length,
      total: ruled.length,
    },
    decisive: { pass: passed(decisive), wins, losses, paired },
    expectedDeferrals: {
      count: expected.filter((record) => record.deferredAsExpected).length,
      total: expected.length,
    },
    stages: {
      selection: stageRatio('selection'),
      actions: stageRatio('actions'),
      layout: stageRatio('layout'),
    },
    fallbacks: {
      total: {
        count: records.filter((record) => (record.fallbackCalls ?? 0) > 0)
          .length,
        total: records.length,
      },
      byReason,
      byStage,
      providerByStage,
    },
    fill: records.reduce(
      (sum, record) => ({
        count: sum.count + (record.fill?.filled ?? 0),
        total: sum.total + (record.fill?.slots ?? 0),
      }),
      { count: 0, total: 0 },
    ),
    latency: {
      turn: spreadOf(records.map((record) => record.turnMs)),
      stages: stageMs,
      jevCall: spreadOf(calls.map((call) => call.latencyMs)),
      llmCall: llm.llmCall,
    },
    tokens: {
      jev: {
        ...jev,
        perTurn: {
          input: jev.input / records.length,
          output: jev.output / records.length,
        },
      },
      llm: llm.tokens,
    },
  };
}

function graderSummary(
  planned: readonly RunRecord[],
  baselines: readonly RunRecord[] | undefined,
): GraderSummary | undefined {
  const attempted = planned.filter((record) => record.grader !== undefined);
  if (attempted.length === 0) return undefined;
  const graded = attempted.filter((record) => record.grader?.dimensions);
  const scoreOf = (record: RunRecord, dimension: GraderDimension) =>
    record.grader?.dimensions?.[dimension].score;
  const meanOf = (values: readonly number[]) =>
    values.length === 0
      ? undefined
      : values.reduce((total, value) => total + value, 0) / values.length;
  const perDimension = <T>(value: (dimension: GraderDimension) => T) =>
    Object.fromEntries(
      GRADER_DIMENSIONS.map((dimension) => [dimension, value(dimension)]),
    ) as Record<GraderDimension, T>;
  const mean = perDimension((dimension) =>
    meanOf(graded.flatMap((record) => scoreOf(record, dimension) ?? [])),
  );
  const versusBaseline =
    baselines &&
    perDimension((dimension) => {
      const differences = graded.flatMap((record) => {
        const own = scoreOf(record, dimension);
        const other = baselines.find(
          (candidate) =>
            candidate.scenarioId === record.scenarioId &&
            candidate.repeat === record.repeat,
        );
        const theirs = other && scoreOf(other, dimension);
        return own === undefined || theirs === undefined ? [] : [own - theirs];
      });
      return { mean: meanOf(differences), pairs: differences.length };
    });
  return {
    graded: graded.length,
    failed: attempted.length - graded.length,
    mean,
    ...(versusBaseline && { versusBaseline }),
    tokens: sum(attempted.flatMap((record) => record.grader?.calls ?? [])),
  };
}

function fixed(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(3);
}

function gateSummary(
  records: readonly RunRecord[],
): ArmSummary['gates'] | undefined {
  const answered = (question: string) =>
    records.flatMap((record) => {
      const answer = record.answers?.find(
        (entry) => entry.stage === 'jevSelect' && entry.question === question,
      );
      return answer ? [{ record, yes: answer.choice === 'yes' }] : [];
    });
  const needsActions = answered('gate/needsActions');
  const spatial = answered('gate/spatial');
  if (needsActions.length === 0 && spatial.length === 0) return undefined;
  return {
    needsActions: errorsOf(needsActions, (record) => record.expectsActions),
    spatial: errorsOf(spatial, (record) => record.spatial),
  };
}

function errorsOf(
  answers: readonly { readonly record: RunRecord; readonly yes: boolean }[],
  truth: (record: RunRecord) => boolean | undefined,
): GateErrors {
  const where = (expected: boolean) =>
    answers.filter(({ record }) => truth(record) === expected);
  const negatives = where(false);
  const positives = where(true);
  return {
    falsePositives: {
      count: negatives.filter((answer) => answer.yes).length,
      total: negatives.length,
    },
    falseNegatives: {
      count: positives.filter((answer) => !answer.yes).length,
      total: positives.length,
    },
  };
}

function gateErrors({ falsePositives, falseNegatives }: GateErrors): string {
  return `${ratio(falsePositives)} / ${ratio(falseNegatives)}`;
}

function llmTotals(
  calls: readonly LlmCall[],
): TokenTotals & { readonly byRole: Readonly<Record<string, TokenTotals>> } {
  const byRole: Record<string, TokenTotals> = {};
  for (const role of LLM_ROLES) {
    const subset = calls.filter((call) => call.role === role);
    if (subset.length > 0) byRole[role] = sum(subset);
  }
  return { ...sum(calls), byRole };
}

function sum(
  calls: readonly {
    readonly usage?: {
      readonly inputTokens: number;
      readonly outputTokens: number;
    };
  }[],
): TokenTotals {
  return {
    calls: calls.length,
    withoutUsage: calls.filter((call) => call.usage === undefined).length,
    input: calls.reduce(
      (total, call) => total + (call.usage?.inputTokens ?? 0),
      0,
    ),
    output: calls.reduce(
      (total, call) => total + (call.usage?.outputTokens ?? 0),
      0,
    ),
  };
}

function verdict(record: RunRecord): string {
  if (record.error) return 'error';
  if (record.layoutOnly === 'handed_off') return 'handed off';
  if (record.score === undefined) return 'no response';
  return record.score.pass ? 'pass' : 'fail';
}

function spreadOf(values: readonly number[]): Percentiles {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    samples: values.length,
  };
}

function ratio({ count, total }: Ratio): string {
  if (total === 0) return 'n/a';
  return `${count}/${total} (${((count / total) * 100).toFixed(1)}%)`;
}

function spread(value: Percentiles): string {
  if (value.p50 === undefined || value.p95 === undefined) return 'n/a';
  return `${Math.round(value.p50)} / ${Math.round(value.p95)}`;
}

function totals(value: TokenTotals): string {
  const missing =
    value.withoutUsage > 0 ? ` (${value.withoutUsage} without usage)` : '';
  return `${value.calls} / ${value.input} / ${value.output}${missing}`;
}

const COMPOSED_ROUTES: readonly ComposedRoute[] = [
  'spatial',
  'same_instances',
  'instances_changed',
];

const HAND_OFF_CAUSES: readonly ComposedHandOff[] = [
  'nothing_fits',
  'none_of_these',
];

const ATTRIBUTION_QUESTIONS: readonly AttributionQuestion[] = [
  'shape',
  'placement',
  'position',
  'size',
];

/** Ranks {@link composeCandidates} (from `layout-composed-tree.ts`) returns, most probable first. */
const CHOSEN_RANKS = [0, 1, 2] as const;

function renderComposed(
  row: (label: string, cell: (summary: ArmSummary) => string) => void,
): void {
  row('Composed layout turns', (s) =>
    s.composed ? String(s.composed.turns) : 'n/a',
  );
  row('Composed layout calls', (s) =>
    s.composed ? ratio(s.composed.calls) : 'n/a',
  );
  for (const route of COMPOSED_ROUTES) {
    row(`Composed route: ${route}`, (s) =>
      s.composed ? ratio(s.composed.routes[route].turns) : 'n/a',
    );
    row(`Composed route: ${route} calls`, (s) =>
      s.composed ? ratio(s.composed.routes[route].calls) : 'n/a',
    );
  }
  row('Composed hand-off rate', (s) =>
    s.composed ? ratio(s.composed.handOff.rate) : 'n/a',
  );
  for (const cause of HAND_OFF_CAUSES)
    row(`Composed hand-off: ${cause}`, (s) =>
      s.composed ? String(s.composed.handOff.byCause[cause]) : 'n/a',
    );
  row('Composed empty-part repairs', (s) =>
    s.composed ? ratio(s.composed.repairs.droppedParts) : 'n/a',
  );
  row('Composed added-part rate', (s) =>
    s.composed ? ratio(s.composed.repairs.addedParts) : 'n/a',
  );
  for (const rank of CHOSEN_RANKS)
    row(`Composed chosen candidate ${rank + 1}`, (s) =>
      s.composed
        ? ratio({
            count: s.composed.chosenIndex.counts[rank] ?? 0,
            total: s.composed.chosenIndex.total,
          })
        : 'n/a',
    );
  row('Composed failure attribution turns', (s) =>
    s.composed ? ratio(s.composed.attribution.attributed) : 'n/a',
  );
  for (const question of ATTRIBUTION_QUESTIONS)
    row(`Composed failure attribution: ${question}`, (s) =>
      s.composed ? String(s.composed.attribution.byQuestion[question]) : 'n/a',
    );
  row('Composed nudged order kept', (s) => {
    if (!s.composed) return 'n/a';
    const kept = s.composed.nudgedOrderKept;
    return kept.derivable ? ratio(kept.ratio) : `not derivable: ${kept.reason}`;
  });
}

/** Every record of `records` with a recorded composition, paired with it. */
function withCompositions(records: readonly RunRecord[]): readonly {
  readonly record: RunRecord;
  readonly composition: ComposedLayoutRecord;
}[] {
  return records.flatMap((record) => {
    const composition = record.stageOutputs?.jevLayout?.composition;
    return composition ? [{ record, composition }] : [];
  });
}

function composedSummaryOf(
  records: readonly RunRecord[],
  scenarioById: ReadonlyMap<string, Scenario>,
): ComposedSummary | undefined {
  const entries = withCompositions(records);
  if (entries.length === 0) return undefined;

  const routes = Object.fromEntries(
    COMPOSED_ROUTES.map((route) => {
      const inRoute = entries.filter(
        (entry) => entry.composition.route === route,
      );
      return [
        route,
        {
          turns: { count: inRoute.length, total: entries.length },
          calls: {
            count: inRoute.filter((entry) => entry.composition.called).length,
            total: inRoute.length,
          },
        },
      ];
    }),
  ) as Readonly<Record<ComposedRoute, ComposedRouteSummary>>;

  const called = entries.filter((entry) => entry.composition.called);
  const handedOff = called.filter(
    (entry) => entry.composition.handOff !== undefined,
  );
  const byCause = Object.fromEntries(
    HAND_OFF_CAUSES.map((cause) => [
      cause,
      handedOff.filter((entry) => entry.composition.handOff === cause).length,
    ]),
  ) as Readonly<Record<ComposedHandOff, number>>;

  const chosen = entries.filter(
    (entry) => entry.composition.chosen !== undefined,
  );
  const chosenCandidate = (entry: (typeof chosen)[number]) =>
    entry.composition.candidates[entry.composition.chosen as number];
  const droppedParts = chosen.filter(
    (entry) => (chosenCandidate(entry)?.droppedParts.length ?? 0) > 0,
  );
  const addedParts = chosen.filter(
    (entry) => (chosenCandidate(entry)?.addedParts.length ?? 0) > 0,
  );
  const chosenCounts: number[] = [];
  for (const entry of chosen) {
    const rank = entry.composition.chosen as number;
    chosenCounts[rank] = (chosenCounts[rank] ?? 0) + 1;
  }

  return {
    turns: entries.length,
    routes,
    calls: { count: called.length, total: entries.length },
    handOff: {
      rate: { count: handedOff.length, total: called.length },
      byCause,
    },
    repairs: {
      droppedParts: { count: droppedParts.length, total: chosen.length },
      addedParts: { count: addedParts.length, total: chosen.length },
    },
    chosenIndex: { counts: chosenCounts, total: chosen.length },
    attribution: attributionOf(entries, scenarioById),
    nudgedOrderKept: nudgedOrderKeptOf(entries, scenarioById),
  };
}

function attributionOf(
  entries: ReturnType<typeof withCompositions>,
  scenarioById: ReadonlyMap<string, Scenario>,
): ComposedSummary['attribution'] {
  const byQuestion: Record<AttributionQuestion, number> = {
    shape: 0,
    placement: 0,
    position: 0,
    size: 0,
  };
  let eligible = 0;
  let attributed = 0;
  for (const { record, composition } of entries) {
    if (!composition.called || !composition.answers) continue;
    if (record.score?.arrangement?.pass !== false) continue;
    const referenceTree = scenarioById.get(record.scenarioId)?.expected.tree;
    if (referenceTree === undefined) continue;
    eligible += 1;
    const question = attributeFailure(
      composition.answers,
      referenceTree as readonly TilingNode[],
    );
    if (question === undefined) continue;
    attributed += 1;
    byQuestion[question] += 1;
  }
  return { attributed: { count: attributed, total: eligible }, byQuestion };
}

/**
 * Attributes a failed arrangement to the first composed-layout question
 * Jev's answers disagree with the reference tree's top split: `shape`
 * (direction or part count), then per visible Instance `placement` (which
 * part) and `position` (order within the part). When all three agree the
 * failure attributes to `size` by elimination. `undefined` when the
 * reference tree's top level cannot be read as a composed shape, or an
 * answered Instance is missing from the reference tree.
 */
function attributeFailure(
  answers: ComposedAnswers,
  referenceTree: readonly TilingNode[],
): AttributionQuestion | undefined {
  const root = parseReferenceNode(referenceTree, 0)?.node;
  if (root === undefined || root.kind !== 'split') return undefined;
  const expectedShape = shapeKeyOf(root.axis, root.children.length);
  if (expectedShape === undefined) return undefined;
  if (answers.shape.choice !== expectedShape) return 'shape';

  const expectedPlacement = new Map<string, number>();
  const expectedPosition = new Map<string, number>();
  root.children.forEach((child, partIndex) => {
    leavesOf(child).forEach((instanceId, position) => {
      expectedPlacement.set(instanceId, partIndex);
      expectedPosition.set(instanceId, position);
    });
  });

  const instanceIds = Object.keys(answers.placements);
  for (const instanceId of instanceIds) {
    const part = expectedPlacement.get(instanceId);
    if (part === undefined) return undefined;
    if (answers.placements[instanceId]?.choice !== PARTS[part])
      return 'placement';
  }
  for (const instanceId of instanceIds) {
    const position = expectedPosition.get(instanceId);
    if (position === undefined) return undefined;
    if (answers.positions[instanceId]?.choice !== POSITIONS[position])
      return 'position';
  }
  return 'size';
}

interface ReferenceLeaf {
  readonly kind: 'leaf';
  readonly instanceId: string | null;
}

interface ReferenceSplit {
  readonly kind: 'split';
  readonly axis: 'H' | 'V';
  readonly children: readonly ReferenceNode[];
}

type ReferenceNode = ReferenceLeaf | ReferenceSplit;

/** Reads one preorder node of a reference tree from `index`, recursing over a split's declared arity. */
function parseReferenceNode(
  tree: readonly TilingNode[],
  index: number,
): { readonly node: ReferenceNode; readonly next: number } | undefined {
  const token = tree[index];
  if (token === undefined) return undefined;
  const branch = parseTilingSplitToken(token);
  if (!branch)
    return {
      node: {
        kind: 'leaf',
        instanceId: token === null ? null : tilingLeafInstanceId(token),
      },
      next: index + 1,
    };
  const children: ReferenceNode[] = [];
  let cursor = index + 1;
  for (const _weight of branch.weights) {
    const child = parseReferenceNode(tree, cursor);
    if (child === undefined) return undefined;
    children.push(child.node);
    cursor = child.next;
  }
  return { node: { kind: 'split', axis: branch.axis, children }, next: cursor };
}

function leavesOf(node: ReferenceNode): readonly string[] {
  if (node.kind === 'leaf')
    return node.instanceId === null ? [] : [node.instanceId];
  return node.children.flatMap(leavesOf);
}

/** A composed shape's key for a top split with `partCount` children, within the 2 to 4 parts Jev is offered. */
function shapeKeyOf(axis: 'H' | 'V', partCount: number): string | undefined {
  if (partCount < 2 || partCount > PARTS.length) return undefined;
  return `${axis === 'V' ? 'side_by_side' : 'stacked'}_${partCount}`;
}

function nudgedOrderKeptOf(
  entries: ReturnType<typeof withCompositions>,
  scenarioById: ReadonlyMap<string, Scenario>,
): NudgedOrderKept {
  if (scenarioById.size === 0)
    return {
      derivable: false,
      reason: "no scenario was joined to read the request's current tree",
    };
  const nudged = entries.filter((entry) => entry.composition.nudged);
  let count = 0;
  let total = 0;
  for (const { record } of nudged) {
    const scenario = scenarioById.get(record.scenarioId);
    if (scenario === undefined || record.tree === undefined) continue;
    const currentTree =
      scenario.request.layout.type === 'tiling'
        ? scenario.request.layout.tree
        : [];
    const currentIds = leafIds(currentTree);
    const shippedIds = leafIds(record.tree as readonly TilingNode[]);
    const shippedSet = new Set(shippedIds);
    const currentSet = new Set(currentIds);
    const keptCurrentOrder = currentIds.filter((id) => shippedSet.has(id));
    const keptShippedOrder = shippedIds.filter((id) => currentSet.has(id));
    total += 1;
    if (JSON.stringify(keptCurrentOrder) === JSON.stringify(keptShippedOrder))
      count += 1;
  }
  return { derivable: true, ratio: { count, total } };
}

function leafIds(tree: readonly TilingNode[]): readonly string[] {
  return tree.flatMap((token) => tilingLeafInstanceId(token) ?? []);
}
