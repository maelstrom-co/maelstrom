/** Provider provenance is evidence, not inferred from the score. */
export interface JudgeProvenance {
  /** LLM, explicitly non-LLM heuristic, or undeclared/unknown source. */
  readonly kind: 'llm' | 'heuristic' | 'unknown';
  /** Provider identifier, never a credential or endpoint. */
  readonly provider: string;
  /** Model identifier when known. */
  readonly model?: string;
}

/** Versioned rubric identity; incompatible rubrics must never share an aggregate. */
export interface JudgeRubricIdentity {
  /** Stable bounded rubric name. */
  readonly id: string;
  /** Positive version of its questions and evidence interpretation. */
  readonly version: number;
}

/** One finite value with an explicit scale. */
export interface JudgeScore {
  /** Stable dimension name. */
  readonly name: string;
  /** Observed score, within its scale. */
  readonly value: number;
  /** Scale lower bound. */
  readonly min: number;
  /** Scale upper bound. */
  readonly max: number;
}

/** Bounded secondary evidence, independent of deterministic correctness. */
export type EvaluationJudgeResult =
  | {
      /** Envelope schema version. */
      readonly schemaVersion: 1;
      /** A complete numeric secondary verdict. */
      readonly status: 'scored';
      /** Rubric used for these dimensions. */
      readonly rubric: JudgeRubricIdentity;
      /** Provider/model that produced this verdict. */
      readonly provenance: JudgeProvenance;
      /** Descriptive values do not establish calibrated model quality. */
      readonly calibration: 'unvalidated';
      /** Nonempty unique dimensions and their explicit scales. */
      readonly scores: readonly JudgeScore[];
    }
  | {
      /** Envelope schema version. */
      readonly schemaVersion: 1;
      /** Attempted judging produced no numeric verdict. */
      readonly status: 'failed';
      /** Sanitized code, never provider error text. */
      readonly reason: 'provider_failure' | 'invalid_result' | 'exception';
      /** Attempted rubric, when known. */
      readonly rubric?: JudgeRubricIdentity;
      /** Attempted provider/model, when known. */
      readonly provenance?: JudgeProvenance;
    }
  | {
      /** Envelope schema version. */
      readonly schemaVersion: 1;
      /** No judging operation was performed. */
      readonly status: 'not_run';
      /** Explicit coverage limitation. */
      readonly reason:
        | 'disabled'
        | 'no_valid_evidence'
        | 'unsupported_surface'
        | 'historical_unknown';
      /** Selected rubric, when known. */
      readonly rubric?: JudgeRubricIdentity;
      /** Selected provider/model, when known. */
      readonly provenance?: JudgeProvenance;
    };

/** Runtime-neutral strict validator; rejects raw content and nonfinite scores before publication. */
export const evaluationJudgeSchema = {
  /** Returns detached validated evidence, or rejects malformed input. */
  parse: parseJudgeResult,
  /** Validates without exposing unchecked input or parser errors. */
  safeParse(
    value: unknown,
  ): { success: true; data: EvaluationJudgeResult } | { success: false } {
    try {
      return { success: true, data: parseJudgeResult(value) };
    } catch {
      return { success: false };
    }
  },
};

function parseJudgeResult(value: unknown): EvaluationJudgeResult {
  const result = object(value);
  if (result.schemaVersion !== 1) throw new Error('Unsupported judge schema');
  const rubric =
    result.rubric === undefined ? undefined : parseRubric(result.rubric);
  const provenance =
    result.provenance === undefined
      ? undefined
      : parseProvenance(result.provenance);
  const identity = {
    ...(rubric && { rubric }),
    ...(provenance && { provenance }),
  };
  if (result.status === 'scored') {
    keys(result, [
      'schemaVersion',
      'status',
      'rubric',
      'provenance',
      'calibration',
      'scores',
    ]);
    if (
      !rubric ||
      !provenance ||
      result.calibration !== 'unvalidated' ||
      !Array.isArray(result.scores) ||
      result.scores.length < 1 ||
      result.scores.length > 16
    )
      throw new Error('Invalid judge result');
    if (Reflect.ownKeys(result.scores).length !== result.scores.length + 1)
      throw new Error('Invalid judge scores');
    const scores = Array.from(
      { length: result.scores.length },
      (_, index): JudgeScore => {
        const property = Object.getOwnPropertyDescriptor(
          result.scores,
          String(index),
        );
        if (!property?.enumerable || !('value' in property))
          throw new Error('Invalid judge score property');
        const entry: unknown = property.value;
        const score = object(entry);
        keys(score, ['name', 'value', 'min', 'max']);
        if (
          !finite(score.value) ||
          !finite(score.min) ||
          !finite(score.max) ||
          score.min >= score.max ||
          score.value < score.min ||
          score.value > score.max
        )
          throw new Error('Invalid judge score');
        return {
          name: name(score.name),
          value: score.value,
          min: score.min,
          max: score.max,
        };
      },
    );
    if (new Set(scores.map((s) => s.name)).size !== scores.length)
      throw new Error('Duplicate judge dimension');
    return {
      schemaVersion: 1,
      status: 'scored',
      rubric,
      provenance,
      calibration: 'unvalidated',
      scores,
    };
  }
  keys(result, ['schemaVersion', 'status', 'reason', 'rubric', 'provenance']);
  if (
    result.status === 'failed' &&
    (result.reason === 'provider_failure' ||
      result.reason === 'invalid_result' ||
      result.reason === 'exception')
  )
    return {
      schemaVersion: 1,
      status: 'failed',
      reason: result.reason,
      ...identity,
    };
  if (
    result.status === 'not_run' &&
    (result.reason === 'disabled' ||
      result.reason === 'no_valid_evidence' ||
      result.reason === 'unsupported_surface' ||
      result.reason === 'historical_unknown')
  )
    return {
      schemaVersion: 1,
      status: 'not_run',
      reason: result.reason,
      ...identity,
    };
  throw new Error('Invalid judge status');
}

function parseRubric(value: unknown): JudgeRubricIdentity {
  const rubric = object(value);
  keys(rubric, ['id', 'version']);
  return { id: name(rubric.id), version: version(rubric.version) };
}

function parseProvenance(value: unknown): JudgeProvenance {
  const source = object(value);
  keys(source, ['kind', 'provider', 'model']);
  if (
    source.kind !== 'llm' &&
    source.kind !== 'heuristic' &&
    source.kind !== 'unknown'
  )
    throw new Error('Invalid judge provenance');
  return {
    kind: source.kind,
    provider: text(source.provider, 100),
    ...(source.model === undefined ? {} : { model: text(source.model, 200) }),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Expected plain judge evidence');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor?.enumerable ||
      !('value' in descriptor)
    )
      throw new Error('Invalid judge property');
  }
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unexpected judge field');
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Invalid judge text');
  return value;
}
function name(value: unknown): string {
  const result = text(value, 64);
  if (!/^[a-z][a-z0-9_]*$/.test(result))
    throw new Error('Invalid judge identifier');
  return result;
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('Invalid judge version');
  return value;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Records absence explicitly, without manufacturing a zero score. */
export function judgeNotRun(
  reason: Extract<EvaluationJudgeResult, { status: 'not_run' }>['reason'],
): EvaluationJudgeResult {
  return { schemaVersion: 1, status: 'not_run', reason };
}

/** Validates stored/public evidence; absent historical evidence is unknown, not disabled. */
export function normalizeJudgeResult(value: unknown): EvaluationJudgeResult {
  return value === undefined
    ? judgeNotRun('historical_unknown')
    : evaluationJudgeSchema.parse(value);
}

/** Imports the native two-dimension rubric without exporting its calls or failure text. */
export function judgeFromGrader(
  value: unknown,
  source: JudgeProvenance = { kind: 'unknown', provider: 'historical' },
): EvaluationJudgeResult {
  if (value === undefined) return judgeNotRun('historical_unknown');
  const grade = object(value);
  const graderVersion = version(grade.graderVersion);
  const verbalizerVersion = version(grade.verbalizerVersion);
  if (grade.failure !== undefined) {
    if (typeof grade.failure !== 'string')
      throw new Error('Invalid grader failure');
    if (grade.dimensions !== undefined)
      throw new Error('Ambiguous grader result');
    return evaluationJudgeSchema.parse({
      schemaVersion: 1,
      ...(grade.failure === 'grader/not_tiling'
        ? { status: 'not_run', reason: 'unsupported_surface' }
        : { status: 'failed', reason: 'provider_failure' }),
      provenance: source,
      rubric: {
        id: `planner_response_text_${verbalizerVersion}`,
        version: graderVersion,
      },
    });
  }
  if (!grade.dimensions) throw new Error('Missing grader dimensions');
  return evaluationJudgeSchema.parse({
    schemaVersion: 1,
    status: 'scored',
    // The verbalizer changes the evidence, so it is part of the rubric identity.
    rubric: {
      id: `planner_response_text_${verbalizerVersion}`,
      version: graderVersion,
    },
    provenance: source,
    calibration: 'unvalidated',
    scores: ['request_satisfied', 'arrangement_match'].map((name) => ({
      name,
      value: object(object(grade.dimensions)[name]).score,
      min: 0,
      max: 1,
    })),
  });
}

/** Coverage and aggregates grouped by rubric, dimension and scale, never pooled across rubrics. */
export interface JudgeSummary {
  /** Samples with a numeric secondary verdict. */
  readonly scored: number;
  /** Samples whose judge failed. */
  readonly failed: number;
  /** Samples with no judge verdict, including disabled and historical samples. */
  readonly notRun: number;
  /** Explicit coverage gaps by bounded reason. */
  readonly reasons: Readonly<Record<string, number>>;
  /** Unvalidated descriptive means; these do not certify a calibrated judge. */
  readonly means: readonly {
    /** Rubric name and version. */
    readonly rubric: string;
    /** Judge provenance kept separate across provider/model/kind. */
    readonly provenance: JudgeProvenance;
    /** Dimension name. */
    readonly dimension: string;
    /** Scale lower bound. */
    readonly min: number;
    /** Scale upper bound. */
    readonly max: number;
    /** Samples with this dimension and scale. */
    readonly count: number;
    /** Mean over those samples only. */
    readonly mean: number;
  }[];
}

/** Summarizes secondary verdicts without changing the primary pass rate. */
export function summarizeJudges(
  values: readonly (EvaluationJudgeResult | undefined)[],
): JudgeSummary {
  let scored = 0;
  let failed = 0;
  let notRun = 0;
  const reasons: Record<string, number> = {};
  const groups = new Map<
    string,
    {
      rubric: string;
      provenance: JudgeProvenance;
      dimension: string;
      min: number;
      max: number;
      count: number;
      mean: number;
    }
  >();
  for (const value of values) {
    const judge = normalizeJudgeResult(value);
    if (judge.status !== 'scored') {
      if (judge.status === 'failed') failed++;
      else notRun++;
      reasons[judge.reason] = (reasons[judge.reason] ?? 0) + 1;
      continue;
    }
    scored++;
    for (const score of judge.scores) {
      const rubric = `${judge.rubric.id}/v${judge.rubric.version}`;
      const key = JSON.stringify([
        rubric,
        score.name,
        score.min,
        score.max,
        judge.provenance.kind,
        judge.provenance.provider,
        judge.provenance.model,
      ]);
      const previous = groups.get(key);
      const count = (previous?.count ?? 0) + 1;
      groups.set(key, {
        rubric,
        provenance: judge.provenance,
        dimension: score.name,
        min: score.min,
        max: score.max,
        count,
        mean:
          (previous?.mean ?? 0) * ((count - 1) / count) + score.value / count,
      });
    }
  }
  return { scored, failed, notRun, reasons, means: [...groups.values()] };
}

/** Human-readable coverage and rubric-separated descriptive scores for any report. */
export function renderJudgeSummary(summary: JudgeSummary): string {
  return [
    `Judge: ${summary.scored} scored, ${summary.failed} failed, ${summary.notRun} not run.`,
    ...Object.entries(summary.reasons).map(
      ([reason, count]) => `${reason}: ${count}.`,
    ),
    ...summary.means.map(
      (s) =>
        `${s.rubric} (${s.provenance.kind}, ${s.provenance.provider}${s.provenance.model ? `/${s.provenance.model}` : ''}) ${s.dimension}: ${s.mean.toFixed(3)} [${s.min}, ${s.max}], n=${s.count} (unvalidated).`,
    ),
  ].join(' ');
}

/** Normalizes current records and historical native grader-only records without regrading. */
export function recordJudgeResult(record: {
  readonly judge?: unknown;
  readonly grader?: unknown;
}): EvaluationJudgeResult {
  return record.judge === undefined
    ? judgeFromGrader(record.grader)
    : normalizeJudgeResult(record.judge);
}
