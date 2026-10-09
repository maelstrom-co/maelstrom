import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { pluginOf } from './arms.js';
import { GRADER_DIMENSIONS, type GraderDimension } from './grader.js';
import { type GraderValidation, graderGate } from './grader-validate.js';
import {
  extendOwned,
  type PlannerEvalPlugin,
  type ReportRow,
} from './plugin.js';
import type { RunRecord } from './run.js';
import type { Suite } from './scenarios.js';
import { PLANNER_RATIO, percentile, type Ratio, ratio } from './stats.js';
import { LLM_ROLES, type LlmCall } from './usage-adapter.js';

export interface Percentiles {
  readonly p50: number | undefined;
  readonly p95: number | undefined;
  readonly samples: number;
}

export interface TokenTotals {
  readonly calls: number;
  readonly input: number;
  readonly output: number;
  /** Calls missing input or output usage; totals sum only reported counters. */
  readonly withoutUsage: number;
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
  /** The judge's own usage, never part of the arm's planner cost. */
  readonly tokens: TokenTotals;
}

/**
 * One arm's numbers over one suite. A staged arm's plugin adds its own
 * fields through `summarizeArm`, which the index signatures admit; the
 * named fields are the runner's own, and the report throws when a plugin
 * names one.
 */
export interface ArmSummary {
  readonly [field: string]: unknown;
  readonly arm: string;
  readonly kind: string;
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
   * Staged arms only: planned turns no stage deferred, their pass rate, and
   * wins and losses against the baseline on the same scenario and repeat.
   */
  readonly decisive?: {
    readonly pass: Ratio;
    readonly wins: number;
    readonly losses: number;
    readonly paired: number;
  };
  /** Staged arms only: expected-deferral scenarios that deferred at the expected phase. */
  readonly expectedDeferrals?: Ratio;
  /**
   * Staged arms only: runs that fell back, by full `<stage>/<code>` reason
   * and by stage. `byStage` leaves out `provider_*` deferrals, which are
   * counted in `providerByStage`.
   */
  readonly fallbacks?: {
    readonly total: Ratio;
    readonly byReason: Readonly<Record<string, number>>;
    readonly byStage: Readonly<Record<string, number>>;
    readonly providerByStage: Readonly<Record<string, number>>;
  };
  /** Stages replayed from a recorded run; their latency is left out. */
  readonly replayed: readonly string[];
  /** Present when any of the arm's turns was graded. */
  readonly grader?: GraderSummary;
  readonly latency: {
    readonly [field: string]: unknown;
    readonly turn: Percentiles;
    /** Live stage runs only, one entry per stage of the plugin's `stageOrder`. */
    readonly stages?: Readonly<Record<string, Percentiles>>;
    readonly llmCall: Readonly<Record<string, Percentiles>>;
  };
  readonly tokens: {
    readonly [field: string]: unknown;
    readonly llm: TokenTotals & {
      readonly byRole: Readonly<Record<string, TokenTotals>>;
    };
  };
}

/** What the report needs beyond the records: the plugins that own the arms, and the grader gate. */
export interface ReportOptions {
  readonly plugins: readonly PlannerEvalPlugin[];
  readonly graderValidation?: GraderValidation;
}

/**
 * One summary per arm and suite present, plus `all` per arm, arms in the
 * order records name them. An arm no plugin registers gets the runner's
 * fields only.
 */
export function summarize(
  records: readonly RunRecord[],
  plugins: readonly PlannerEvalPlugin[],
): ArmSummary[] {
  const summaries: ArmSummary[] = [];
  const arms = [...new Set(records.map((record) => record.arm))];
  const suites = [...new Set(records.map((record) => record.suite))];
  for (const arm of arms)
    for (const suite of [...suites, 'all'] as const) {
      const inSuite = (record: RunRecord) =>
        suite === 'all' || record.suite === suite;
      const subset = records.filter(
        (record) => record.arm === arm && inSuite(record),
      );
      if (subset.length > 0)
        summaries.push(
          summarizeArm(
            suite,
            subset,
            records.filter(
              (record) => record.kind === 'baseline' && inSuite(record),
            ),
            pluginOf(plugins, arm),
          ),
        );
    }
  return summaries;
}

/**
 * A Markdown report with the arms side by side, per suite. Each plugin
 * with an arm in the suite adds its rows to the runner's, by section. When
 * any turn was graded, the grader's rows appear only if
 * `options.graderValidation` passes {@link graderGate}; otherwise one line
 * says the grader is unvalidated.
 */
export function renderMarkdown(
  summaries: readonly ArmSummary[],
  meta: Readonly<Record<string, unknown>>,
  options: ReportOptions,
): string {
  const lines = ['# planner eval', ''];
  for (const [key, value] of Object.entries(meta))
    lines.push(
      `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    );
  const gate = summaries.some((summary) => summary.grader !== undefined)
    ? graderGate(options.graderValidation)
    : undefined;
  if (gate) lines.push('', gate.line);
  const suites = [...new Set(summaries.map((summary) => summary.suite))];
  for (const suite of suites) {
    const rows = summaries.filter((summary) => summary.suite === suite);
    const extra = pluginRows(rows, options.plugins);
    lines.push('', `## ${suite}`, '');
    lines.push(`| Metric | ${rows.map((row) => row.arm).join(' | ')} |`);
    lines.push(`| --- | ${rows.map(() => '---').join(' | ')} |`);
    const row = (label: string, cell: (summary: ArmSummary) => string) =>
      lines.push(`| ${label} | ${rows.map(cell).join(' | ')} |`);
    const section = (name: NonNullable<ReportRow['section']>) => {
      for (const entry of extra.filter(
        (candidate) => (candidate.section ?? 'outcomes') === name,
      ))
        row(entry.label, (summary) => entry.cell(summary));
    };
    row('Runs', (s) => String(s.runs));
    row('Overall pass', (s) => ratio(s.overall, PLANNER_RATIO));
    row('Arrangement pass', (s) => ratio(s.arrangement, PLANNER_RATIO));
    row('Errors', (s) => String(s.errors));
    row('Decisive turns pass', (s) =>
      s.decisive ? ratio(s.decisive.pass, PLANNER_RATIO) : 'n/a',
    );
    row('Decisive wins / losses vs baseline (paired)', (s) =>
      s.decisive
        ? `${s.decisive.wins} / ${s.decisive.losses} (${s.decisive.paired})`
        : 'n/a',
    );
    row('Expected deferrals at the right stage', (s) =>
      s.expectedDeferrals ? ratio(s.expectedDeferrals, PLANNER_RATIO) : 'n/a',
    );
    row('Fallback rate', (s) =>
      s.fallbacks ? ratio(s.fallbacks.total, PLANNER_RATIO) : 'n/a',
    );
    const reasons = [
      ...new Set(rows.flatMap((s) => Object.keys(s.fallbacks?.byReason ?? {}))),
    ].sort();
    for (const reason of reasons)
      row(`Fallbacks: ${reason}`, (s) =>
        s.fallbacks ? String(s.fallbacks.byReason[reason] ?? 0) : 'n/a',
      );
    section('outcomes');
    row('Replayed stages', (s) =>
      s.replayed.length > 0 ? s.replayed.join(', ') : 'none',
    );
    row('Turn latency p50 / p95 (ms)', (s) => spread(s.latency.turn));
    section('latency');
    const roles = LLM_ROLES.filter((role) =>
      rows.some((s) => s.tokens.llm.byRole[role] !== undefined),
    );
    for (const role of roles)
      row(`LLM ${role} call latency p50 / p95 (ms)`, (s) =>
        s.latency.llmCall[role] ? spread(s.latency.llmCall[role]) : 'n/a',
      );
    section('tokens');
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
          ? ratio(
              {
                count: s.grader.failed,
                total: s.grader.graded + s.grader.failed,
              },
              PLANNER_RATIO,
            )
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
    if (record.expectedDeferral) continue;
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
 * `out`; `options.graderValidation` decides whether the grader's rows appear.
 */
export async function writeReport(
  out: string,
  records: readonly RunRecord[],
  meta: Readonly<Record<string, unknown>>,
  options: ReportOptions,
): Promise<ArmSummary[]> {
  const summaries = summarize(records, options.plugins);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'records.json'), JSON.stringify(records, null, 2));
  await writeFile(
    join(out, 'summary.json'),
    JSON.stringify(
      {
        meta,
        summaries,
        ...(options.graderValidation && {
          graderValidation: options.graderValidation,
        }),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(out, 'report.md'),
    renderMarkdown(summaries, meta, options),
  );
  await writeFile(join(out, 'paired.md'), renderPaired(records));
  return summaries;
}

/** Totals over calls that may carry usage: count, tokens, and calls without usage. */
export function tokenTotals(
  calls: readonly {
    readonly usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    };
  }[],
): TokenTotals {
  return {
    calls: calls.length,
    withoutUsage: calls.filter(
      (call) =>
        call.usage?.inputTokens === undefined ||
        call.usage?.outputTokens === undefined,
    ).length,
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

/** p50 and p95 of `values` with the sample count. */
export function spreadOf(values: readonly number[]): Percentiles {
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    samples: values.length,
  };
}

/** `p50 / p95` rounded, or `n/a` without samples. */
export function spread(value: Percentiles): string {
  if (value.p50 === undefined || value.p95 === undefined) return 'n/a';
  return `${Math.round(value.p50)} / ${Math.round(value.p95)}`;
}

/** `calls / input / output`, naming the calls without usage when any. */
export function totals(value: TokenTotals): string {
  const missing =
    value.withoutUsage > 0 ? ` (${value.withoutUsage} without usage)` : '';
  return `${value.calls} / ${value.input} / ${value.output}${missing}`;
}

function pluginRows(
  rows: readonly ArmSummary[],
  plugins: readonly PlannerEvalPlugin[],
): readonly ReportRow[] {
  const present = plugins.filter((plugin) =>
    rows.some((summary) => pluginOf([plugin], summary.arm) === plugin),
  );
  return present.flatMap((plugin) => plugin.reportRows?.(rows) ?? []);
}

function summarizeArm(
  suite: Suite | 'all',
  records: readonly RunRecord[],
  baselines: readonly RunRecord[],
  plugin: PlannerEvalPlugin | undefined,
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
  const stageMs: Record<string, Percentiles> = {};
  for (const stage of plugin?.stageOrder ?? [])
    stageMs[stage] = spreadOf(
      records.flatMap((record) =>
        (record.stages ?? [])
          .filter((entry) => entry.stage === stage && !entry.replayed)
          .map((entry) => entry.ms),
      ),
    );
  const extension = plugin?.summarizeArm?.(records) ?? {};
  const {
    latency: extraLatency = {},
    tokens: extraTokens = {},
    ...extraFields
  } = extension;
  const owner = plugin?.name ?? '';
  const owned = {
    ...common,
    decisive: { pass: passed(decisive), wins, losses, paired },
    expectedDeferrals: {
      count: expected.filter((record) => record.deferredAsExpected).length,
      total: expected.length,
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
  };
  return {
    ...extendOwned(owned, extraFields, {
      plugin: owner,
      where: 'an arm summary',
      reserved: ARM_SUMMARY_FIELDS,
    }),
    latency: extendOwned(
      {
        turn: spreadOf(records.map((record) => record.turnMs)),
        ...(plugin?.stageOrder && { stages: stageMs }),
        llmCall: llm.llmCall,
      },
      extraLatency,
      {
        plugin: owner,
        where: 'an arm summary latency',
        reserved: LATENCY_FIELDS,
      },
    ),
    tokens: extendOwned({ llm: llm.tokens }, extraTokens, {
      plugin: owner,
      where: 'an arm summary tokens',
    }),
  };
}

const ARM_SUMMARY_FIELDS = [
  'arm',
  'kind',
  'suite',
  'runs',
  'overall',
  'arrangement',
  'errors',
  'spatial',
  'decisive',
  'expectedDeferrals',
  'fallbacks',
  'replayed',
  'grader',
  'latency',
  'tokens',
] as const satisfies readonly (keyof ArmSummary)[];

const LATENCY_FIELDS = ['turn', 'stages', 'llmCall'] as const;

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
    tokens: tokenTotals(
      attempted.flatMap((record) => record.grader?.calls ?? []),
    ),
  };
}

function fixed(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(3);
}

function llmTotals(
  calls: readonly LlmCall[],
): TokenTotals & { readonly byRole: Readonly<Record<string, TokenTotals>> } {
  const byRole: Record<string, TokenTotals> = {};
  for (const role of LLM_ROLES) {
    const subset = calls.filter((call) => call.role === role);
    if (subset.length > 0) byRole[role] = tokenTotals(subset);
  }
  return { ...tokenTotals(calls), byRole };
}

function verdict(record: RunRecord): string {
  if (record.error) return 'error';
  if (record.score === undefined) return 'no response';
  return record.score.pass ? 'pass' : 'fail';
}
