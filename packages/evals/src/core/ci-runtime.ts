import type { EvaluationRunAccounting } from './run-orchestration.js';

/** Fails CI on infrastructure errors, never on deterministic evaluation scores. */
export function assertEvaluationRuntime(
  accounting: EvaluationRunAccounting,
  records: readonly {
    readonly error?: unknown;
    readonly outcome?: string;
    readonly deferral?: {
      readonly provider: boolean;
      readonly reason?: string;
    };
    readonly calls?: readonly { readonly outcome?: string }[];
    readonly jevCalls?: readonly { readonly outcome?: string }[];
  }[],
): void {
  if (
    accounting.execution.error > 0 ||
    accounting.execution.invalid > 0 ||
    accounting.cleanupFailures > 0 ||
    accounting.judge.failed > 0 ||
    records.some(
      (record) =>
        record.error !== undefined ||
        record.outcome === 'error' ||
        (record.deferral?.provider &&
          record.deferral.reason?.split('/')[1] !== 'provider_refusal') ||
        [...(record.calls ?? []), ...(record.jevCalls ?? [])].some(
          (call) =>
            call.outcome !== undefined &&
            call.outcome !== 'ok' &&
            call.outcome !== 'provider_refusal',
        ),
    )
  )
    throw new Error(
      'Evaluation runtime failed; see the completed Markdown report. Scores are informational.',
    );
}
