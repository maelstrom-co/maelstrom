import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Arm, RunRecord } from './run.js';
import type { Suite } from './scenarios.js';

const STAGES = ['jevSelect', 'jevActions', 'jevLayout', 'llmComplete'] as const;

export interface Ratio {
  readonly count: number;
  readonly total: number;
}

export interface Percentiles {
  readonly p50: number | undefined;
  readonly p95: number | undefined;
  readonly samples: number;
}

export interface ArmSummary {
  readonly arm: Arm;
  readonly suite: Suite | 'all';
  readonly runs: number;
  /** Shipped responses that pass, over planned scenarios (expected deferrals excluded). */
  readonly overall: Ratio;
  readonly errors: number;
  /** POC only: expected-deferral scenarios that deferred at the expected stage. */
  readonly expectedDeferrals?: Ratio;
  readonly stages?: {
    readonly selection: Ratio;
    readonly actions: Ratio;
    readonly layout: Ratio;
  };
  /** POC only: runs that fell back, by deferring stage, with provider_* failures counted separately. */
  readonly fallbacks?: {
    readonly total: Ratio;
    readonly byStage: Readonly<Record<string, number>>;
    readonly providerByStage: Readonly<Record<string, number>>;
  };
  /** POC only: filled stated_elsewhere slots over all such slots. */
  readonly fill?: Ratio;
  readonly latency: {
    readonly turn: Percentiles;
    readonly stages?: Readonly<Record<string, Percentiles>>;
    readonly jevCall?: Percentiles;
  };
  readonly tokens: {
    readonly jev?: {
      readonly calls: number;
      readonly input: number;
      readonly output: number;
    };
    /** `@tanstack/ai`'s non-streaming structured `chat()` does not surface usage here. */
    readonly llm: 'unavailable';
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

/** One summary per arm and suite present, plus `all` per arm. */
export function summarize(records: readonly RunRecord[]): ArmSummary[] {
  const summaries: ArmSummary[] = [];
  const arms = [...new Set(records.map((record) => record.arm))];
  const suites = [...new Set(records.map((record) => record.suite))];
  for (const arm of arms)
    for (const suite of [...suites, 'all'] as const) {
      const subset = records.filter(
        (record) =>
          record.arm === arm && (suite === 'all' || record.suite === suite),
      );
      if (subset.length > 0) summaries.push(summarizeArm(arm, suite, subset));
    }
  return summaries;
}

/** A Markdown report with the arms side by side, per suite. */
export function renderMarkdown(
  summaries: readonly ArmSummary[],
  meta: Readonly<Record<string, string | number>>,
): string {
  const lines = ['# planner-jev eval', ''];
  for (const [key, value] of Object.entries(meta))
    lines.push(`- ${key}: ${value}`);
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
    row('Errors', (s) => String(s.errors));
    row('Expected deferrals at the right stage', (s) =>
      s.expectedDeferrals ? ratio(s.expectedDeferrals) : 'n/a',
    );
    row('Selection accuracy', (s) =>
      s.stages ? ratio(s.stages.selection) : 'n/a',
    );
    row('Actions accuracy', (s) =>
      s.stages ? ratio(s.stages.actions) : 'n/a',
    );
    row('Layout accuracy (loose)', (s) =>
      s.stages ? ratio(s.stages.layout) : 'n/a',
    );
    row('Fallback rate', (s) =>
      s.fallbacks ? ratio(s.fallbacks.total) : 'n/a',
    );
    for (const stage of STAGES) {
      row(`Fallbacks from ${stage}`, (s) =>
        s.fallbacks ? String(s.fallbacks.byStage[stage] ?? 0) : 'n/a',
      );
      row(`Provider fallbacks from ${stage}`, (s) =>
        s.fallbacks ? String(s.fallbacks.providerByStage[stage] ?? 0) : 'n/a',
      );
    }
    row('llmComplete fill rate', (s) => (s.fill ? ratio(s.fill) : 'n/a'));
    row('Turn latency p50 / p95 (ms)', (s) => spread(s.latency.turn));
    for (const stage of STAGES)
      row(`${stage} latency p50 / p95 (ms)`, (s) =>
        s.latency.stages?.[stage] ? spread(s.latency.stages[stage]) : 'n/a',
      );
    row('Jev call latency p50 / p95 (ms)', (s) =>
      s.latency.jevCall ? spread(s.latency.jevCall) : 'n/a',
    );
    row('Jev calls / input / output tokens', (s) =>
      s.tokens.jev
        ? `${s.tokens.jev.calls} / ${s.tokens.jev.input} / ${s.tokens.jev.output}`
        : 'n/a',
    );
    row('LLM tokens', (s) => s.tokens.llm);
  }
  return `${lines.join('\n')}\n`;
}

/** Writes `records.json`, `summary.json` and `report.md` to `out`. */
export async function writeReport(
  out: string,
  records: readonly RunRecord[],
  meta: Readonly<Record<string, string | number>>,
): Promise<ArmSummary[]> {
  const summaries = summarize(records);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'records.json'), JSON.stringify(records, null, 2));
  await writeFile(
    join(out, 'summary.json'),
    JSON.stringify({ meta, summaries }, null, 2),
  );
  await writeFile(join(out, 'report.md'), renderMarkdown(summaries, meta));
  return summaries;
}

function summarizeArm(
  arm: Arm,
  suite: Suite | 'all',
  records: readonly RunRecord[],
): ArmSummary {
  const planned = records.filter((record) => !record.expectedDeferral);
  const overall = {
    count: planned.filter((record) => record.score?.pass === true).length,
    total: planned.length,
  };
  const latency = {
    turn: spreadOf(records.map((record) => record.turnMs)),
  };
  const errors = records.filter((record) => record.error !== undefined).length;
  if (arm === 'baseline')
    return {
      arm,
      suite,
      runs: records.length,
      overall,
      errors,
      latency,
      tokens: { llm: 'unavailable' },
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
  const byStage: Record<string, number> = {};
  const providerByStage: Record<string, number> = {};
  for (const record of records) {
    if (!record.deferral) continue;
    const bucket = record.deferral.provider ? providerByStage : byStage;
    bucket[record.deferral.stage] = (bucket[record.deferral.stage] ?? 0) + 1;
  }
  const expected = records.filter((record) => record.expectedDeferral);
  const calls = records.flatMap((record) => record.jevCalls ?? []);
  const stageMs: Record<string, Percentiles> = {};
  for (const stage of STAGES)
    stageMs[stage] = spreadOf(
      records.flatMap((record) =>
        (record.stages ?? [])
          .filter((entry) => entry.stage === stage)
          .map((entry) => entry.ms),
      ),
    );
  return {
    arm,
    suite,
    runs: records.length,
    overall,
    errors,
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
      ...latency,
      stages: stageMs,
      jevCall: spreadOf(calls.map((call) => call.latencyMs)),
    },
    tokens: {
      jev: {
        calls: calls.length,
        input: calls.reduce(
          (sum, call) => sum + (call.usage?.inputTokens ?? 0),
          0,
        ),
        output: calls.reduce(
          (sum, call) => sum + (call.usage?.outputTokens ?? 0),
          0,
        ),
      },
      llm: 'unavailable',
    },
  };
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
