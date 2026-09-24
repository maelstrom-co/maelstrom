import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  consoleLogger,
  createEngine,
  type Logger,
  type PlannerCandidate,
} from '@maelstrom-co/engine';
import { createTypeSafeClient } from '@maelstrom-co/planner-jev/_eval';
import {
  ChartRequestMessage,
  isOk,
  type MaelstromResponse,
  MessageId,
  ok,
  parseTilingSplitToken,
  SessionId,
  type TilingNode,
  tilingLeafInstanceId,
} from '@maelstrom-co/protocol';
import {
  GRADER_DIMENSIONS,
  GRADER_VERSION,
  type GraderCall,
  type GraderDimension,
  type GraderGrade,
  gradeResponse,
  type ShippedResponse,
} from './grader.js';
import type { StageRecord } from './instrument.js';
import type { StageFile } from './replay.js';
import type { RunRecord } from './run.js';
import { type Scenario, selectScenarios } from './scenarios.js';
import { VERBALIZER_VERSION } from './verbalize-tree.js';

/** The grader may appear in `report.md` only at or above this rank correlation on every dimension. */
export const MIN_RANK_CORRELATION = 0.7;

/** The grader may appear in `report.md` only at or above this pass/fail agreement with the rule-based arrangement score. */
export const MIN_AGREEMENT = 0.85;

/** Fewer matched labels than this never pass the gate, whatever the correlation. */
export const MIN_LABELS = 10;

/** A grade counts as a pass at or above this normalised score. */
export const PASS_THRESHOLD = 0.5;

/**
 * One hand label: a shipped response from a recorded run, identified by the
 * record's `scenarioId`, `arm` and `repeat`, scored from 0 to 1 on each
 * grader dimension. `src/eval/fixtures/grader-labels.ts` exports
 * `graderLabels`, an array of these.
 */
export type GraderLabel = {
  readonly scenarioId: string;
  readonly arm: string;
  readonly repeat: number;
  readonly note?: string;
} & Readonly<Record<GraderDimension, number>>;

/** One stored grade, keyed like a {@link GraderLabel}. */
export interface GradedResponse {
  readonly arm: string;
  readonly scenarioId: string;
  readonly repeat: number;
  readonly grade: GraderGrade;
  readonly calls?: readonly GraderCall[];
}

/** How the grader's scores compare with the hand labels and the rule-based score, and whether it passed the gate. */
export interface GraderValidation {
  readonly graderVersion: number;
  readonly verbalizerVersion: number;
  /** Labels given, and those whose response has a usable grade. */
  readonly labels: { readonly total: number; readonly matched: number };
  /** Spearman rank correlation with the labels; `undefined` when it cannot be computed. */
  readonly rho: Readonly<Record<GraderDimension, number | undefined>>;
  /** The weaker dimension's correlation, the one the gate reads. */
  readonly gateRho: number | undefined;
  readonly meanAbsoluteError: Readonly<
    Record<GraderDimension, number | undefined>
  >;
  /**
   * Turns of development scenarios with arrangement rules where
   * `arrangement_match` at or above {@link PASS_THRESHOLD} agrees with the
   * rule-based arrangement pass, over those with a usable grade.
   */
  readonly agreement: { readonly agree: number; readonly total: number };
  readonly passed: boolean;
}

/** Where the hand labels live; the file may be absent. */
export const DEFAULT_LABELS_PATH = join(
  import.meta.dir,
  'fixtures/grader-labels.ts',
);

/** Spearman rank correlation with average ranks for ties; `undefined` for fewer than two pairs or no spread. */
export function spearman(
  xs: readonly number[],
  ys: readonly number[],
): number | undefined {
  if (xs.length !== ys.length || xs.length < 2) return undefined;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const mx = mean(rx);
  const my = mean(ry);
  let covariance = 0;
  let vx = 0;
  let vy = 0;
  for (let index = 0; index < rx.length; index++) {
    const dx = rx[index] - mx;
    const dy = ry[index] - my;
    covariance += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return undefined;
  return covariance / Math.sqrt(vx * vy);
}

/**
 * Compares grades with the hand labels (rank correlation and mean absolute
 * error per dimension) and with the rule-based arrangement pass on every
 * planned development turn whose scenario declares arrangement rules.
 * Grades from another grader or verbalizer version, and failed grades, are
 * left out.
 */
export function validateGrader(input: {
  readonly labels: readonly GraderLabel[];
  readonly records: readonly RunRecord[];
  readonly grades: readonly GradedResponse[];
}): GraderValidation {
  const usable = new Map<string, GraderGrade>();
  for (const entry of input.grades)
    if (isCurrent(entry.grade) && entry.grade.dimensions)
      usable.set(keyOf(entry), entry.grade);

  const matched = input.labels.flatMap((label) => {
    const grade = usable.get(keyOf(label));
    return grade?.dimensions ? [{ label, dimensions: grade.dimensions }] : [];
  });
  const rho = {} as Record<GraderDimension, number | undefined>;
  const meanAbsoluteError = {} as Record<GraderDimension, number | undefined>;
  for (const dimension of GRADER_DIMENSIONS) {
    const labelled = matched.map(({ label }) => label[dimension]);
    const graded = matched.map(({ dimensions }) => dimensions[dimension].score);
    rho[dimension] = spearman(graded, labelled);
    meanAbsoluteError[dimension] =
      matched.length === 0
        ? undefined
        : graded.reduce(
            (sum, value, index) => sum + Math.abs(value - labelled[index]),
            0,
          ) / matched.length;
  }
  const correlations = GRADER_DIMENSIONS.map((dimension) => rho[dimension]);
  const gateRho = correlations.some((value) => value === undefined)
    ? undefined
    : Math.min(...(correlations as number[]));

  let agree = 0;
  let total = 0;
  for (const record of input.records) {
    const rule = record.score?.arrangement;
    if (
      record.suite !== 'development' ||
      record.expectedDeferral ||
      !record.arrangementRules ||
      rule === undefined
    )
      continue;
    const grade = usable.get(keyOf(record))?.dimensions;
    if (grade === undefined) continue;
    total += 1;
    if (grade.arrangement_match.score >= PASS_THRESHOLD === rule.pass)
      agree += 1;
  }

  return {
    graderVersion: GRADER_VERSION,
    verbalizerVersion: VERBALIZER_VERSION,
    labels: { total: input.labels.length, matched: matched.length },
    rho,
    gateRho,
    meanAbsoluteError,
    agreement: { agree, total },
    passed:
      matched.length >= MIN_LABELS &&
      gateRho !== undefined &&
      gateRho >= MIN_RANK_CORRELATION &&
      total > 0 &&
      agree / total >= MIN_AGREEMENT,
  };
}

/**
 * Whether the grader may appear in a report: `validation` passed and was
 * made with the current grader and verbalizer. `line` states the verdict
 * with the numbers it rests on, `n/a` for any that could not be computed.
 */
export function graderGate(validation: GraderValidation | undefined): {
  readonly validated: boolean;
  readonly line: string;
} {
  const validated =
    validation?.passed === true &&
    validation.graderVersion === GRADER_VERSION &&
    validation.verbalizerVersion === VERBALIZER_VERSION;
  const rho =
    validation?.gateRho === undefined ? 'n/a' : validation.gateRho.toFixed(2);
  const agreement =
    validation === undefined || validation.agreement.total === 0
      ? 'n/a'
      : `${((validation.agreement.agree / validation.agreement.total) * 100).toFixed(1)}%`;
  return {
    validated,
    line: `grader: ${validated ? 'validated' : 'unvalidated'} (rho=${rho}, agreement=${agreement})`,
  };
}

/**
 * Checks that `value` is a well-formed {@link GraderValidation}, the shape
 * `grader-validate.ts` writes to `grader-validation.json`. A dimension's
 * correlation or error may be absent, matching a round trip through JSON,
 * which drops an undefined-valued key.
 */
export function isGraderValidation(value: unknown): value is GraderValidation {
  return (
    isRecord(value) &&
    isFiniteNumber(value.graderVersion) &&
    isFiniteNumber(value.verbalizerVersion) &&
    isRecord(value.labels) &&
    isCount(value.labels.total) &&
    isCount(value.labels.matched) &&
    isDimensionMap(value.rho) &&
    isOptionalNumber(value.gateRho) &&
    isDimensionMap(value.meanAbsoluteError) &&
    isRecord(value.agreement) &&
    isCount(value.agreement.agree) &&
    isCount(value.agreement.total) &&
    typeof value.passed === 'boolean'
  );
}

/** The labels exported as `graderLabels` from `path`; none when the file does not exist. */
export async function loadGraderLabels(
  path: string = DEFAULT_LABELS_PATH,
): Promise<readonly GraderLabel[]> {
  if (!existsSync(path)) return [];
  const module = (await import(path)) as { graderLabels?: unknown };
  if (!Array.isArray(module.graderLabels))
    throw new Error(`${path} must export graderLabels, an array of labels`);
  return module.graderLabels as readonly GraderLabel[];
}

/**
 * The shipped response of a recorded turn, from the first source that has
 * it: the shipped plan and instances the record carries (runs since the
 * grader existed; a record that carries a plan but no instances shipped a
 * non-tiling layout and has none); the completion stage's candidate, on a
 * turn that did not fall back, healed by the Engine as it was when shipped
 * and accepted only when the healed message and tree are the ones the
 * record shipped; or, for a turn recorded against a scenario that expected
 * no actions, the rule-based score itself, when it found no action or
 * variant failure and every leaf is an existing instance, which proves the
 * plan was empty and every leaf kept its variant. `undefined` otherwise.
 */
export async function shippedFromRecord(
  record: RunRecord,
  scenario: Scenario,
  stages?: readonly StageRecord[],
): Promise<ShippedResponse | undefined> {
  if (record.userMessage === undefined || record.tree === undefined)
    return undefined;
  const tree = record.tree as readonly TilingNode[];
  const shipped = { userMessage: record.userMessage, tree };
  if (record.executionPlan !== undefined)
    return record.instances === undefined
      ? undefined
      : {
          ...shipped,
          executionPlan: record.executionPlan,
          instances: record.instances,
        };
  if (record.fallbackCalls === 0) {
    const candidate = stages?.find(
      (stage) => stage.stage === 'llmComplete' && stage.outcome === 'ok',
    )?.output;
    const healed =
      candidate === undefined
        ? undefined
        : await healCandidate(scenario, candidate as PlannerCandidate);
    if (
      healed?.layout.type === 'tiling' &&
      healed.userMessage === record.userMessage &&
      JSON.stringify(healed.layout.tree) === JSON.stringify(tree)
    )
      return {
        ...shipped,
        executionPlan: healed.executionPlan,
        instances: healed.layout.instances,
      };
  }
  const existing = new Set<string>(
    scenario.request.instances.map((instance) => instance.instanceId),
  );
  const provenEmpty =
    record.score !== undefined &&
    record.expectsActions === false &&
    scenario.expected.actions?.length === 0 &&
    !record.score.failures.some((failure) =>
      UNPROVEN_PLAN.some((prefix) => failure.startsWith(prefix)),
    ) &&
    tree.every((token) => {
      const id = tilingLeafInstanceId(token);
      return (
        parseTilingSplitToken(token) !== null ||
        (id !== null && existing.has(id))
      );
    });
  return provenEmpty
    ? { ...shipped, executionPlan: [], instances: scenario.request.instances }
    : undefined;
}

const UNPROVEN_PLAN = [
  'Ordered actions',
  'Variant of',
  'Execution plan does not simulate',
  'Response layout is not tiling',
];

async function healCandidate(
  scenario: Scenario,
  candidate: PlannerCandidate,
): Promise<MaelstromResponse | undefined> {
  const engine = createEngine({
    planner: async () => ok(candidate),
    retry: false,
    logger: silent,
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId('grader-validate'),
      id: MessageId(`${scenario.id}-heal`),
      request: scenario.request,
    }),
  );
  return isOk(result) && result.value.type === 'chart_response'
    ? result.value.response
    : undefined;
}

function isCurrent(grade: GraderGrade): boolean {
  return (
    grade.graderVersion === GRADER_VERSION &&
    grade.verbalizerVersion === VERBALIZER_VERSION
  );
}

function keyOf(entry: {
  readonly arm: string;
  readonly scenarioId: string;
  readonly repeat: number;
}): string {
  return `${entry.arm}\u0000${entry.scenarioId}\u0000${entry.repeat}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isDimensionMap(
  value: unknown,
): value is Readonly<Record<GraderDimension, number | undefined>> {
  return (
    isRecord(value) &&
    GRADER_DIMENSIONS.every((dimension) => isOptionalNumber(value[dimension]))
  );
}

function ranks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (
      end + 1 < order.length &&
      order[end + 1].value === order[start].value
    )
      end += 1;
    const rank = (start + end) / 2 + 1;
    for (let position = start; position <= end; position++)
      result[order[position].index] = rank;
    start = end + 1;
  }
  return result;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      records: { type: 'string' },
      scores: { type: 'string' },
      labels: { type: 'string' },
      out: { type: 'string' },
      arm: { type: 'string', multiple: true },
      limit: { type: 'string' },
      offline: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
    },
  });
  if (values.records === undefined)
    fail(
      'usage: bun src/eval/grader-validate.ts --records <records.json> [--scores <grader-scores.json>] [--labels <file>] [--out <dir>] [--arm <arm>]... [--limit <n>] [--offline] [--verbose]',
    );
  const recordsPath = resolve(values.records);
  const out = resolve(values.out ?? dirname(recordsPath));
  const scoresPath = resolve(values.scores ?? join(out, 'grader-scores.json'));
  const limit =
    values.limit === undefined
      ? Number.POSITIVE_INFINITY
      : Number(values.limit);
  if (!(limit >= 0) || (Number.isFinite(limit) && !Number.isInteger(limit)))
    fail('--limit must be a non-negative integer');

  const records = (
    JSON.parse(await readFile(recordsPath, 'utf8')) as RunRecord[]
  ).filter((record) => record.suite === 'development');
  const labels = await loadGraderLabels(
    values.labels === undefined ? undefined : resolve(values.labels),
  );
  const cached: GradedResponse[] = existsSync(scoresPath)
    ? (JSON.parse(await readFile(scoresPath, 'utf8')) as GradedResponse[])
    : [];
  const grades = new Map<string, GradedResponse>();
  for (const entry of cached)
    if (isCurrent(entry.grade) && entry.grade.dimensions)
      grades.set(keyOf(entry), entry);

  const labelled = new Set(labels.map(keyOf));
  const arms = values.arm;
  const targets = records
    .filter(
      (record) =>
        labelled.has(keyOf(record)) ||
        (record.arrangementRules &&
          !record.expectedDeferral &&
          record.score?.arrangement !== undefined &&
          (arms === undefined || arms.includes(record.arm))),
    )
    .sort(
      (a, b) => Number(labelled.has(keyOf(b))) - Number(labelled.has(keyOf(a))),
    )
    .filter((record) => !grades.has(keyOf(record)));

  const scenarios = new Map(
    selectScenarios('development').map((scenario) => [scenario.id, scenario]),
  );
  let skipped = 0;
  let failed = 0;
  let graded = 0;
  if (!values.offline && targets.length > 0 && limit > 0) {
    const apiKey = process.env.TYPESAFE_API_KEY?.trim() ?? '';
    const model = process.env.JEV_MODEL?.trim() ?? '';
    if (apiKey.length === 0 || model.length === 0)
      fail(
        'grader-validate needs TYPESAFE_API_KEY and JEV_MODEL to grade; pass --offline to validate cached grades only',
      );
    const logger: Logger = values.verbose ? consoleLogger : silent;
    let calls: GraderCall[] = [];
    const ask = createTypeSafeClient({
      apiKey,
      model,
      onCall: ({ latencyMs, usage, outcome }) =>
        calls.push({ latencyMs, outcome, ...(usage && { usage }) }),
    });
    const stageDir = join(dirname(recordsPath), 'stages');
    for (const record of targets) {
      if (graded + failed >= limit) break;
      const scenario = scenarios.get(record.scenarioId);
      const shipped =
        scenario &&
        (await shippedFromRecord(
          record,
          scenario,
          await stagesOf(stageDir, record),
        ));
      if (scenario === undefined || shipped === undefined) {
        skipped += 1;
        continue;
      }
      calls = [];
      const grade = await gradeResponse(
        ask,
        { request: scenario.request, response: shipped },
        { logger },
      );
      const entry: GradedResponse = {
        arm: record.arm,
        scenarioId: record.scenarioId,
        repeat: record.repeat,
        grade,
        calls,
      };
      if (grade.dimensions) {
        graded += 1;
        grades.set(keyOf(entry), entry);
      } else failed += 1;
      console.log(
        `${record.arm.padEnd(10)} ${record.scenarioId} #${record.repeat} ${
          grade.dimensions
            ? GRADER_DIMENSIONS.map(
                (dimension) =>
                  `${dimension}=${grade.dimensions?.[dimension].score.toFixed(2)}`,
              ).join(' ')
            : `failed ${grade.failure}`
        }`,
      );
      await mkdir(dirname(scoresPath), { recursive: true });
      await writeFile(
        scoresPath,
        JSON.stringify([...grades.values()], null, 2),
      );
    }
  }

  const validation = validateGrader({
    labels,
    records,
    grades: [...grades.values()],
  });
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'grader-validation.json'),
    JSON.stringify(validation, null, 2),
  );
  const usage = [...grades.values()]
    .flatMap((entry) => entry.calls ?? [])
    .reduce(
      (sum, call) => ({
        calls: sum.calls + 1,
        input: sum.input + (call.usage?.inputTokens ?? 0),
        output: sum.output + (call.usage?.outputTokens ?? 0),
      }),
      { calls: 0, input: 0, output: 0 },
    );
  console.log(
    [
      `graded ${graded}, failed ${failed}, skipped ${skipped} (no shipped response recoverable), not attempted ${targets.length - graded - failed - skipped} (--offline or --limit), ${grades.size} usable grades`,
      `grader usage: ${usage.calls} calls / ${usage.input} input / ${usage.output} output tokens`,
      `labels: ${validation.labels.matched} of ${validation.labels.total} matched`,
      ...GRADER_DIMENSIONS.map(
        (dimension) =>
          `${dimension}: rho=${format(validation.rho[dimension])}, mean absolute error=${format(validation.meanAbsoluteError[dimension])}`,
      ),
      `arrangement agreement: ${validation.agreement.agree}/${validation.agreement.total}`,
      graderGate(validation).line,
      `Validation written to ${join(out, 'grader-validation.json')}`,
    ].join('\n'),
  );
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {} };

async function stagesOf(
  dir: string,
  record: RunRecord,
): Promise<readonly StageRecord[] | undefined> {
  const path = join(
    dir,
    record.arm,
    `${record.scenarioId}-${record.repeat}.json`,
  );
  if (!existsSync(path)) return undefined;
  return (JSON.parse(await readFile(path, 'utf8')) as StageFile).stages;
}

function format(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(3);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (import.meta.main) await main();
