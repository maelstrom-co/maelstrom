import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { StageRunMeta, StageTurnRecord } from './stage-eval.js';
import { percentile, type Ratio, ratio, STAGE_RATIO } from './stats.js';

/** How the turns of scenarios that expect the stage to defer ended. */
export interface ExpectedDeferralSummary {
  readonly turns: number;
  /** Deferred with the expected reason: the passes. */
  readonly deferredRight: number;
  readonly handedOff: number;
  /** Returned an output instead of deferring. */
  readonly wroteTree: number;
  /** Deferred with another reason, or errored. */
  readonly otherDeferral: number;
}

/**
 * One variant's numbers over the turns it ran. Every row but
 * `expectedDeferrals` leaves out the turns of scenarios that expect the
 * stage to defer.
 */
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
  readonly callsPerTurn: number | undefined;
  readonly callLatencyMs: {
    readonly p50: number | undefined;
    readonly p95: number | undefined;
  };
  readonly stageLatencyMs: {
    readonly p50: number | undefined;
    readonly p95: number | undefined;
  };
  readonly tokensPerTurn: {
    readonly input: number | undefined;
    readonly output: number | undefined;
  };
  readonly expectedDeferrals: ExpectedDeferralSummary;
}

/** Summarises `variant`'s records. */
export function summarizeVariant(
  records: readonly StageTurnRecord[],
  variant: string,
): VariantSummary {
  const own = records.filter((record) => record.variant === variant);
  const ran = own.filter(
    (record) =>
      record.outcome !== 'not_applicable' &&
      record.expectedDeferral === undefined,
  );
  const deferralTurns = own.filter(
    (record) =>
      record.outcome !== 'not_applicable' &&
      record.expectedDeferral !== undefined,
  );
  const deferralCount = (...outcomes: StageTurnRecord['outcome'][]) =>
    deferralTurns.filter((record) => outcomes.includes(record.outcome)).length;
  const count = (outcome: StageTurnRecord['outcome']) =>
    ran.filter((record) => record.outcome === outcome).length;
  const passes = count('pass');
  const deferralReasons: Record<string, number> = {};
  for (const record of ran)
    if (record.outcome === 'deferred' && record.reason !== undefined)
      deferralReasons[record.reason] =
        (deferralReasons[record.reason] ?? 0) + 1;
  const calls = ran.flatMap((record) => record.calls);
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
    callsPerTurn: perTurn(calls.length),
    callLatencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    stageLatencyMs: {
      p50: percentile(stageMs, 50),
      p95: percentile(stageMs, 95),
    },
    tokensPerTurn: {
      input: perTurn(sum(calls.map((call) => call.usage?.inputTokens ?? 0))),
      output: perTurn(sum(calls.map((call) => call.usage?.outputTokens ?? 0))),
    },
    expectedDeferrals: {
      turns: deferralTurns.length,
      deferredRight: deferralCount('pass'),
      handedOff: deferralCount('handed_off'),
      wroteTree: deferralCount('fail'),
      otherDeferral: deferralCount('deferred', 'error'),
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

/** What the report names the stage and its provider calls. */
export interface StageReportSubject {
  readonly stage: string;
  /** `Provider` when absent. */
  readonly provider?: string;
}

/**
 * The report: settings, one summary column per variant, deferral reasons,
 * the stage module's own `sections`, and the scenario table.
 */
export function renderStageReport(
  subject: StageReportSubject,
  records: readonly StageTurnRecord[],
  variants: readonly string[],
  meta: StageRunMeta,
  sections: readonly string[] = [],
): string {
  const provider = subject.provider ?? 'Provider';
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
  row('Pass (hand-offs and deferrals count as failures)', (s) =>
    ratio(s.pass, STAGE_RATIO),
  );
  row('Pass over trees written (hand-offs and deferrals left out)', (s) =>
    ratio(s.passScored, STAGE_RATIO),
  );
  row('Handed off', (s) => ratio(s.handedOff, STAGE_RATIO));
  row('Deferred', (s) => ratio(s.deferred, STAGE_RATIO));
  row('Errors', (s) => ratio(s.errors, STAGE_RATIO));
  row('Not applicable scenarios (not run)', (s) => String(s.notApplicable));
  row(`${provider} calls per turn`, (s) => fixed(s.callsPerTurn, 2));
  row(`${provider} call latency p50 / p95 (ms)`, (s) =>
    spread(s.callLatencyMs),
  );
  row('Stage latency p50 / p95 (ms)', (s) => spread(s.stageLatencyMs));
  row(
    `${provider} tokens per turn (input / output)`,
    (s) =>
      `${fixed(s.tokensPerTurn.input, 0)} / ${fixed(s.tokensPerTurn.output, 0)}`,
  );
  if (summaries.some((s) => s.expectedDeferrals.turns > 0)) {
    row('Expected layout deferrals: deferred with the right reason', (s) =>
      ratio(
        {
          count: s.expectedDeferrals.deferredRight,
          total: s.expectedDeferrals.turns,
        },
        STAGE_RATIO,
      ),
    );
    row(
      'Expected layout deferrals: handed off / wrote a tree / other deferral',
      (s) =>
        `${s.expectedDeferrals.handedOff} / ${s.expectedDeferrals.wroteTree} / ${s.expectedDeferrals.otherDeferral}`,
    );
  }
  const reasons = [
    ...new Set(summaries.flatMap((s) => Object.keys(s.deferralReasons))),
  ].sort();
  for (const reason of reasons)
    row(`Deferral: ${reason}`, (s) => String(s.deferralReasons[reason] ?? 0));

  return [
    `# Stage eval: ${subject.stage}`,
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
  subject: StageReportSubject,
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
    `${renderStageReport(subject, records, variants, meta, sections)}\n`,
  );
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
