import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { percentile } from '../eval/report.js';
import type { StageTurnRecord } from './stage-eval.js';

/** A count over a total. */
export interface Ratio {
  readonly count: number;
  readonly total: number;
}

/** One variant's numbers over the turns it ran. */
export interface VariantSummary {
  readonly variant: string;
  /** Turns that ran; not-applicable scenarios are left out. */
  readonly turns: number;
  /** Passes over every turn that ran. */
  readonly pass: Ratio;
  /** Passes over the turns scored pass or fail, which for layout are the turns whose stage wrote a tree. */
  readonly passScored: Ratio;
  readonly handedOff: Ratio;
  readonly deferred: Ratio;
  readonly errors: Ratio;
  /** Deferral reasons with their turn counts. */
  readonly deferralReasons: Readonly<Record<string, number>>;
  /** Scenarios whose input could not be formed; nothing ran for them. */
  readonly notApplicable: number;
  readonly jevCallsPerTurn: number | undefined;
  readonly jevLatencyMs: {
    readonly p50: number | undefined;
    readonly p95: number | undefined;
  };
  readonly stageLatencyMs: {
    readonly p50: number | undefined;
    readonly p95: number | undefined;
  };
  readonly jevTokensPerTurn: {
    readonly input: number | undefined;
    readonly output: number | undefined;
  };
}

/** The run's settings, printed at the top of the report. */
export type StageRunMeta = Readonly<Record<string, string | number | boolean>>;

/** Summarises `variant`'s records. */
export function summarizeVariant(
  records: readonly StageTurnRecord[],
  variant: string,
): VariantSummary {
  const own = records.filter((record) => record.variant === variant);
  const ran = own.filter((record) => record.outcome !== 'not_applicable');
  const count = (outcome: StageTurnRecord['outcome']) =>
    ran.filter((record) => record.outcome === outcome).length;
  const passes = count('pass');
  const deferralReasons: Record<string, number> = {};
  for (const record of ran)
    if (record.outcome === 'deferred' && record.reason !== undefined)
      deferralReasons[record.reason] =
        (deferralReasons[record.reason] ?? 0) + 1;
  const calls = ran.flatMap((record) => record.jevCalls);
  const latencies = calls.map((call) => call.latencyMs);
  const stageMs = ran.flatMap((record) =>
    record.stageMs === undefined ? [] : [record.stageMs],
  );
  const perTurn = (value: number) =>
    ran.length === 0 ? undefined : value / ran.length;
  return {
    variant,
    turns: ran.length,
    pass: { count: passes, total: ran.length },
    passScored: { count: passes, total: passes + count('fail') },
    handedOff: { count: count('handed_off'), total: ran.length },
    deferred: { count: count('deferred'), total: ran.length },
    errors: { count: count('error'), total: ran.length },
    deferralReasons,
    notApplicable: new Set(
      own
        .filter((record) => record.outcome === 'not_applicable')
        .map((record) => record.scenarioId),
    ).size,
    jevCallsPerTurn: perTurn(calls.length),
    jevLatencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    stageLatencyMs: {
      p50: percentile(stageMs, 50),
      p95: percentile(stageMs, 95),
    },
    jevTokensPerTurn: {
      input: perTurn(sum(calls.map((call) => call.usage?.inputTokens ?? 0))),
      output: perTurn(sum(calls.map((call) => call.usage?.outputTokens ?? 0))),
    },
  };
}

/**
 * The scenario by variant table: passes over the turns that ran, with
 * hand-offs (`h`), deferrals (`d`) and errors (`e`) when there are any, and
 * `n/a` for a scenario whose input could not be formed.
 */
export function renderScenarioTable(
  records: readonly StageTurnRecord[],
  variants: readonly string[],
): string {
  const scenarioIds = [...new Set(records.map((record) => record.scenarioId))];
  const lines = [
    `| Scenario | ${variants.join(' | ')} |`,
    `| --- |${variants.map(() => ' --- |').join('')}`,
  ];
  for (const scenarioId of scenarioIds) {
    const cells = variants.map((variant) =>
      scenarioCell(
        records.filter(
          (record) =>
            record.scenarioId === scenarioId && record.variant === variant,
        ),
      ),
    );
    lines.push(`| ${scenarioId} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/**
 * The report: settings, one summary column per variant, deferral reasons,
 * the stage module's own `sections`, and the scenario table.
 */
export function renderStageReport(
  stage: string,
  records: readonly StageTurnRecord[],
  variants: readonly string[],
  meta: StageRunMeta,
  sections: readonly string[] = [],
): string {
  const summaries = variants.map((variant) =>
    summarizeVariant(records, variant),
  );
  const rows: string[] = [
    `| Metric | ${variants.join(' | ')} |`,
    `| --- |${variants.map(() => ' --- |').join('')}`,
  ];
  const row = (label: string, cell: (summary: VariantSummary) => string) =>
    rows.push(`| ${label} | ${summaries.map(cell).join(' | ')} |`);
  row('Turns run', (s) => String(s.turns));
  row('Pass (hand-offs and deferrals count as failures)', (s) => ratio(s.pass));
  row('Pass over trees written (hand-offs and deferrals left out)', (s) =>
    ratio(s.passScored),
  );
  row('Handed off', (s) => ratio(s.handedOff));
  row('Deferred', (s) => ratio(s.deferred));
  row('Errors', (s) => ratio(s.errors));
  row('Not applicable scenarios (not run)', (s) => String(s.notApplicable));
  row('Jev calls per turn', (s) => fixed(s.jevCallsPerTurn, 2));
  row('Jev call latency p50 / p95 (ms)', (s) => spread(s.jevLatencyMs));
  row('Stage latency p50 / p95 (ms)', (s) => spread(s.stageLatencyMs));
  row(
    'Jev tokens per turn (input / output)',
    (s) =>
      `${fixed(s.jevTokensPerTurn.input, 0)} / ${fixed(s.jevTokensPerTurn.output, 0)}`,
  );
  const reasons = [
    ...new Set(summaries.flatMap((s) => Object.keys(s.deferralReasons))),
  ].sort();
  for (const reason of reasons)
    row(`Deferral: ${reason}`, (s) => String(s.deferralReasons[reason] ?? 0));

  return [
    `# Stage eval: ${stage}`,
    Object.entries(meta)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n'),
    '## Summary',
    rows.join('\n'),
    ...sections,
    '## Per scenario',
    'Passes over turns run; `h` handed off, `d` deferred, `e` errors.',
    renderScenarioTable(records, variants),
  ].join('\n\n');
}

/** Writes `records.json`, `meta.json` and `report.md` under `out`. */
export async function writeStageReport(
  out: string,
  stage: string,
  records: readonly StageTurnRecord[],
  variants: readonly string[],
  meta: StageRunMeta,
  sections: readonly string[] = [],
): Promise<void> {
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'records.json'),
    `${JSON.stringify(records, null, 2)}\n`,
  );
  await writeFile(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  await writeFile(
    join(out, 'report.md'),
    `${renderStageReport(stage, records, variants, meta, sections)}\n`,
  );
}

/** `count/total (percent)`, or `0/0`. */
export function ratio({ count, total }: Ratio): string {
  if (total === 0) return '0/0';
  return `${count}/${total} (${Math.round((count / total) * 100)}%)`;
}

function scenarioCell(records: readonly StageTurnRecord[]): string {
  if (records.length === 0) return '';
  if (records.every((record) => record.outcome === 'not_applicable'))
    return 'n/a';
  const count = (outcome: StageTurnRecord['outcome']) =>
    records.filter((record) => record.outcome === outcome).length;
  const extras = [
    ['h', count('handed_off')],
    ['d', count('deferred')],
    ['e', count('error')],
  ]
    .filter(([, value]) => value !== 0)
    .map(([label, value]) => `${label}${value}`);
  return [`${count('pass')}/${records.length}`, ...extras].join(' ');
}

function fixed(value: number | undefined, digits: number): string {
  return value === undefined ? 'n/a' : value.toFixed(digits);
}

function spread(value: {
  readonly p50: number | undefined;
  readonly p95: number | undefined;
}): string {
  return `${fixed(value.p50, 0)} / ${fixed(value.p95, 0)}`;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
