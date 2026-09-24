import { STAGE_NAMES } from '@maelstrom-co/planner-jev/_eval';
import type { ArmSummaryExtension, ReportRow } from '../../core/plugin.js';
import {
  type ArmSummary,
  type Percentiles,
  spread,
  spreadOf,
  type TokenTotals,
  tokenTotals,
  totals,
} from '../../core/report.js';
import { PLANNER_RATIO, type Ratio, ratio } from '../../core/stats.js';
import type { JevRunRecord } from './record.js';

/** How often a yes/no gate answered wrongly. */
export interface GateErrors {
  /** Yes where the answer should be no, over turns whose answer should be no. */
  readonly falsePositives: Ratio;
  /** No where the answer should be yes, over turns whose answer should be yes. */
  readonly falseNegatives: Ratio;
}

/** The fields the Jev plugin adds to a Jev arm's summary. */
export type JevSummaryFields = {
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
  readonly arrangementReachedLayout: Ratio;
  readonly stages: {
    readonly selection: Ratio;
    readonly actions: Ratio;
    readonly layout: Ratio;
  };
  /** Filled stated_elsewhere slots over all such slots. */
  readonly fill: Ratio;
};

/** TypeSafe usage of one arm, merged into its summary's `tokens`. */
export type JevTokens = {
  readonly jev: TokenTotals & {
    /** Mean TypeSafe tokens per turn. */
    readonly perTurn: { readonly input: number; readonly output: number };
  };
};

/** TypeSafe call latency of one arm, merged into its summary's `latency`. */
export type JevLatency = { readonly jevCall: Percentiles };

/** An arm's summary as the Jev rows read it: the plugin's fields present on Jev arms, absent on others. */
export type JevArmSummary = ArmSummary &
  Partial<JevSummaryFields> & {
    readonly latency: Partial<JevLatency>;
    readonly tokens: Partial<JevTokens>;
  };

/** What the Jev plugin summarises of one arm beyond the runner's own numbers. */
export function jevSummary(
  records: readonly JevRunRecord[],
): ArmSummaryExtension &
  JevSummaryFields & { latency: JevLatency; tokens: JevTokens } {
  const planned = records.filter((record) => !record.expectedDeferral);
  const ruled = planned.filter((record) => record.arrangementRules);
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
  const calls = records.flatMap((record) => record.jevCalls ?? []);
  const jev = tokenTotals(calls);
  const gates = gateSummary(records);
  return {
    ...(gates && { gates }),
    arrangementReachedLayout: {
      count: ruled.filter((record) =>
        (record.stages ?? []).some((entry) => entry.stage === 'jevLayout'),
      ).length,
      total: ruled.length,
    },
    stages: {
      selection: stageRatio('selection'),
      actions: stageRatio('actions'),
      layout: stageRatio('layout'),
    },
    fill: records.reduce(
      (sum, record) => ({
        count: sum.count + (record.fill?.filled ?? 0),
        total: sum.total + (record.fill?.slots ?? 0),
      }),
      { count: 0, total: 0 },
    ),
    latency: { jevCall: spreadOf(calls.map((call) => call.latencyMs)) },
    tokens: {
      jev: {
        ...jev,
        perTurn: {
          input: jev.input / records.length,
          output: jev.output / records.length,
        },
      },
    },
  };
}

/** The Jev rows of a suite's table: stage accuracy, fill, gates, stage latency and TypeSafe usage. */
export function jevRows(): readonly ReportRow[] {
  const jev = (summary: ArmSummary) => summary as JevArmSummary;
  const stageRow = (
    label: string,
    key: keyof JevSummaryFields['stages'],
  ): ReportRow => ({
    label,
    cell: (s) => {
      const { stages } = jev(s);
      return stages ? ratio(stages[key], PLANNER_RATIO) : 'n/a';
    },
  });
  return [
    stageRow('Selection accuracy', 'selection'),
    stageRow('Actions accuracy', 'actions'),
    stageRow('Layout accuracy', 'layout'),
    {
      label: 'llmComplete fill rate',
      cell: (s) => {
        const { fill } = jev(s);
        return fill ? ratio(fill, PLANNER_RATIO) : 'n/a';
      },
    },
    {
      label: 'needsActions gate false positives / negatives',
      cell: (s) => {
        const { gates } = jev(s);
        return gates ? gateErrors(gates.needsActions) : 'n/a';
      },
    },
    {
      label: 'Spatial gate false positives / negatives',
      cell: (s) => {
        const { gates } = jev(s);
        return gates
          ? gateErrors(gates.spatial)
          : `n/a (${s.spatial.spatial} spatial, ${s.spatial.controls} controls)`;
      },
    },
    {
      label: 'Arrangement turns reaching jevLayout',
      cell: (s) => {
        const { arrangementReachedLayout } = jev(s);
        return arrangementReachedLayout
          ? ratio(arrangementReachedLayout, PLANNER_RATIO)
          : 'n/a';
      },
    },
    ...STAGE_NAMES.map(
      (stage): ReportRow => ({
        label: `${stage} latency p50 / p95 (ms)`,
        section: 'latency',
        cell: (s) => {
          const live = s.latency.stages?.[stage];
          if (live && live.samples > 0) return spread(live);
          return s.replayed.includes(stage) ? 'replayed' : 'n/a';
        },
      }),
    ),
    {
      label: 'Jev call latency p50 / p95 (ms)',
      section: 'latency',
      cell: (s) => {
        const { jevCall } = jev(s).latency;
        return jevCall ? spread(jevCall) : 'n/a';
      },
    },
    {
      label: 'Jev calls / input / output tokens',
      section: 'tokens',
      cell: (s) => {
        const { jev: usage } = jev(s).tokens;
        return usage ? totals(usage) : 'n/a';
      },
    },
    {
      label: 'Jev calls per turn',
      section: 'tokens',
      cell: (s) => {
        const { jev: usage } = jev(s).tokens;
        return usage ? (usage.calls / s.runs).toFixed(2) : 'n/a';
      },
    },
    {
      label: 'Jev tokens per turn (input / output)',
      section: 'tokens',
      cell: (s) => {
        const { jev: usage } = jev(s).tokens;
        return usage
          ? `${usage.perTurn.input.toFixed(1)} / ${usage.perTurn.output.toFixed(1)}`
          : 'n/a';
      },
    },
  ];
}

function gateSummary(
  records: readonly JevRunRecord[],
): JevSummaryFields['gates'] | undefined {
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
  answers: readonly { readonly record: JevRunRecord; readonly yes: boolean }[],
  truth: (record: JevRunRecord) => boolean | undefined,
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
  return `${ratio(falsePositives, PLANNER_RATIO)} / ${ratio(falseNegatives, PLANNER_RATIO)}`;
}
