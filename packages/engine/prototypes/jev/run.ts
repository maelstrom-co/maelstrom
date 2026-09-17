import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fixtureJudge, scenarios, score, vessels } from './cases.ts';
import { type Outcome, planWithJev, prepare } from './planner.ts';
import { buildReport } from './report.ts';
import { liveJudge } from './typesafe.ts';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    offline: { type: 'boolean', default: false },
    live: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    model: { type: 'string', default: 'jev-latest' },
    case: { type: 'string' },
    repeats: { type: 'string', default: '1' },
    'min-confidence': { type: 'string', default: '0' },
    out: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(
    'Jev prototype: --offline | --live [--model jev-latest] [--case ID] [--repeats 1] [--min-confidence 0] [--out DIRECTORY] [--verify]\nDefault: offline. Live runs require TYPESAFE_API_KEY. --verify exits nonzero on any failed expectation.',
  );
  process.exit(0);
}
if (values.offline && values.live)
  throw new Error('Choose --offline or --live, not both.');
const live = values.live;
const repeats = Number(values.repeats);
const minimumConfidence = Number(values['min-confidence']);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10)
  throw new Error('--repeats must be an integer from 1 to 10.');
if (
  !Number.isFinite(minimumConfidence) ||
  minimumConfidence < 0 ||
  minimumConfidence > 1
)
  throw new Error('--min-confidence must be between 0 and 1.');
const selected = scenarios.filter(
  (s) =>
    (!values.case || s.id === values.case) && (!live || s.group !== 'compiler'),
);
if (!selected.length)
  throw new Error(
    'No matching scenarios. Compiler fault injections are offline-only.',
  );
const root = resolve(import.meta.dir, '../../../..');
const destination = resolve(
  values.out ?? `${root}/tmp/jev-prototype/${live ? 'live' : 'offline'}`,
);
await mkdir(destination, { recursive: true });

const metadata = {
  mode: live ? 'live' : 'scripted-offline',
  model: live ? values.model : 'scripted-not-jev',
  createdAt: new Date().toISOString(),
  minimumConfidence,
  liveStatus: live
    ? process.env.TYPESAFE_API_KEY
      ? 'attempted'
      : 'blocked_missing_key'
    : 'not_run',
  interpretation: live
    ? 'Synthetic development cases; not a held-out benchmark.'
    : 'Hand-authored judgments verify the compiler only. No Jev inference, accuracy, latency, or cost was measured.',
};
if (live && !process.env.TYPESAFE_API_KEY) {
  await Bun.write(
    `${destination}/summary.json`,
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  console.error(
    `Live evaluation blocked: TYPESAFE_API_KEY is not set. Status written to ${destination}/summary.json`,
  );
  process.exit(2);
}

const records: ReportRecord[] = [];
const fullTraces: unknown[] = [];
const liveProvider = live ? liveJudge(values.model) : undefined;
for (let repeat = 1; repeat <= repeats; repeat++) {
  for (const scenario of selected) {
    const start = performance.now();
    try {
      const outcome = await planWithJev(
        scenario.input,
        liveProvider ?? fixtureJudge(scenario),
        scenario.minimumConfidence ?? minimumConfidence,
      );
      const failures = score(scenario, outcome, !live);
      const { traces, ...result } = outcome;
      const record: ReportRecord = {
        id: scenario.id,
        title: scenario.title,
        why: scenario.why,
        group: scenario.group,
        repeat,
        input: scenario.input,
        expected: scenario.expected,
        result,
        failures,
        elapsedMs: live ? performance.now() - start : null,
        requests: traces.length,
        traces: traces.map((t) => ({
          stage: t.stage,
          questionCount: Object.keys(t.request.questions).length,
          requestBytes: t.requestBytes,
          elapsedMs: live ? t.elapsedMs : null,
          model: t.response.model,
          usage: live ? t.response.usage : null,
          choices: Object.fromEntries(
            Object.entries(t.response.answers).map(([key, answer]) => [
              key,
              { choice: answer.choice, confidence: answer.confidence },
            ]),
          ),
        })),
      };
      records.push(record);
      fullTraces.push({ id: scenario.id, repeat, traces });
      console.log(
        `${failures.length ? 'FAIL' : 'PASS'} ${scenario.id}: ${outcome.status}${outcome.status === 'deferred' ? ` (${outcome.reason})` : ''}; ${traces.length} ${live ? 'API' : 'scripted'} calls`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      records.push({
        id: scenario.id,
        title: scenario.title,
        why: scenario.why,
        group: scenario.group,
        repeat,
        input: scenario.input,
        expected: scenario.expected,
        result: { status: 'error', message },
        failures: [message],
        elapsedMs: live ? performance.now() - start : null,
        requests: null,
        traces: [],
      });
      console.error(`ERROR ${scenario.id}: ${message}`);
      // Credentials, overload, and contract failures are not model accuracy observations.
      if (live) break;
    }
  }
  if (live && records.some((r) => r.result.status === 'error')) break;
}

const parameters = vessels.flatMap((v) =>
  Object.entries(v.variants).flatMap(([variant, definition]) =>
    definition.actions.flatMap((a) =>
      (a.parameters ?? []).map((p) => ({
        vessel: v.id,
        variant,
        action: a.name,
        parameter: p.name,
        type: p.type,
        enumValues: p.enum?.length ?? 0,
        required: p.required !== false,
      })),
    ),
  ),
);
const questionBudgets = selected.map((s) => {
  const evaluation = prepare(s.input).evaluation;
  return {
    id: s.id,
    questions: Object.keys(evaluation.questions).length,
    maximumOptions: Math.max(
      ...Object.values(evaluation.questions).map(
        (q) => Object.keys(q.criteria).length,
      ),
    ),
    bytes: Buffer.byteLength(JSON.stringify(evaluation)),
  };
});
const measured = records
  .flatMap((r) =>
    r.elapsedMs === null || r.result.status === 'error' ? [] : [r.elapsedMs],
  )
  .sort((a, b) => a - b);
const percentile = (p: number) =>
  measured.length
    ? measured[Math.max(0, Math.ceil(measured.length * p) - 1)]
    : null;
const summary = {
  ...metadata,
  plannedTrials: selected.length * repeats,
  completedTrials: records.filter((r) => r.result.status !== 'error').length,
  failedExpectations: records.filter((r) => r.failures.length).length,
  planned: records.filter((r) => r.result.status === 'planned').length,
  deferred: records.filter((r) => r.result.status === 'deferred').length,
  errors: records.filter((r) => r.result.status === 'error').length,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  tokens: live
    ? records
        .flatMap((r) => r.traces)
        .reduce(
          (total, t) => ({
            input: total.input + (t.usage?.input_tokens ?? 0),
            output: total.output + (t.usage?.output_tokens ?? 0),
          }),
          { input: 0, output: 0 },
        )
    : null,
  costUsd: null,
  parameterAudit: {
    catalogSource:
      'Base demo definitions. VesselOptionSync supplies additional runtime enums for existing task, event, and journal titles.',
    totalVariantParameterOccurrences: parameters.length,
    enumConstrainedOccurrences: parameters.filter((p) => p.enumValues > 0)
      .length,
    openOccurrences: parameters.filter((p) => p.enumValues === 0).length,
    details: parameters,
  },
  questionBudgets,
};
await Bun.write(
  `${destination}/summary.json`,
  `${JSON.stringify(summary, null, 2)}\n`,
);
await Bun.write(
  `${destination}/results.json`,
  `${JSON.stringify(records, null, 2)}\n`,
);
await Bun.write(
  `${destination}/traces.json`,
  `${JSON.stringify(fullTraces, null, 2)}\n`,
);
await buildReport(destination, summary, records);
console.log(
  `\n${records.length - summary.failedExpectations}/${records.length} expectations passed. ${metadata.interpretation}\nOpen ${destination}/report.html`,
);
if (
  values.verify &&
  (summary.failedExpectations > 0 ||
    records.length !== selected.length * repeats)
)
  process.exitCode = 1;

export interface ReportRecord {
  id: string;
  title: string;
  why: string;
  group: string;
  repeat: number;
  input: (typeof scenarios)[number]['input'];
  expected: (typeof scenarios)[number]['expected'];
  result:
    | Omit<Extract<Outcome, { status: 'planned' }>, 'traces'>
    | Omit<Extract<Outcome, { status: 'deferred' }>, 'traces'>
    | { status: 'error'; message: string };
  failures: string[];
  elapsedMs: number | null;
  requests: number | null;
  traces: {
    stage: string;
    questionCount: number;
    requestBytes: number;
    elapsedMs: number | null;
    model: string;
    usage: { input_tokens: number; output_tokens: number } | null;
    choices: Record<string, { choice: string; confidence: number }>;
  }[];
}
