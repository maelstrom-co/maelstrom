import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { STAGE_NAMES } from '../src/lib/defer.js';
import type { ArmKind } from './arms.js';
import type { RunRecord } from './run.js';
import type { Suite } from './scenarios.js';
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
  /** Stages replayed from a recorded run; their latency is left out. */
  readonly replayed: readonly string[];
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

/** One summary per arm and suite present, plus `all` per arm, arms in the order records name them. */
export function summarize(records: readonly RunRecord[]): ArmSummary[] {
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
          ),
        );
    }
  return summaries;
}

/** A Markdown report with the arms side by side, per suite. */
export function renderMarkdown(
  summaries: readonly ArmSummary[],
  meta: Readonly<Record<string, unknown>>,
): string {
  const lines = ['# planner-jev eval', ''];
  for (const [key, value] of Object.entries(meta))
    lines.push(
      `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
    );
  const suites = [...new Set(summaries.map((summary) => summary.suite))];
  for (const suite of suites) {
    const rows = summaries.filter((summary) => summary.suite === suite);
    lines.push('', `## ${suite}`, '');
    lines.push(`| Metric | ${rows.map((row) => row.arm).join(' | ')} |`);
    lines.push(`| --- | ${rows.map(() => '---').join(' | ')} |`);
    const row = (label: string, cell: (summary: ArmSummary) => string) =>
      lines.push(`| ${label} | ${rows.map(cell).join(' | ')} |`);
    row('Runs', (s) => String(s.runs));
    row('Overall pass', (s) => ratio(s.overall));
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
    row(
      'Spatial gate false positives / negatives',
      (s) =>
        `n/a (${s.spatial.spatial} spatial, ${s.spatial.controls} controls)`,
    );
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

/** Writes `records.json`, `summary.json`, `report.md` and `paired.md` to `out`. */
export async function writeReport(
  out: string,
  records: readonly RunRecord[],
  meta: Readonly<Record<string, unknown>>,
): Promise<ArmSummary[]> {
  const summaries = summarize(records);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'records.json'), JSON.stringify(records, null, 2));
  await writeFile(
    join(out, 'summary.json'),
    JSON.stringify({ meta, summaries }, null, 2),
  );
  await writeFile(join(out, 'report.md'), renderMarkdown(summaries, meta));
  await writeFile(join(out, 'paired.md'), renderPaired(records));
  return summaries;
}

function summarizeArm(
  suite: Suite | 'all',
  records: readonly RunRecord[],
  baselines: readonly RunRecord[],
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
  return {
    ...common,
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
