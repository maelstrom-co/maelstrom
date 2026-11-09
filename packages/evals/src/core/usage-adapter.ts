import type { ReportedLlmUsage } from '@maelstrom-co/telemetry/usage';
import type { ProviderCallRecord } from '@maelstrom-co/telemetry/usage-adapter';

export { withUsage } from '@maelstrom-co/telemetry/usage-adapter';

/** Every LLM role, in report order. */
export const LLM_ROLES = [
  'planner',
  'fallback',
  'complete',
  'layout',
  'grader',
] as const;

/** What an LLM call did for the turn. */
export type LlmRole = (typeof LLM_ROLES)[number];

/** Provider counters, without inferred zeros, token totals, or price estimates. */
export type LlmUsage = ReportedLlmUsage;

/** One role-labelled provider call, without the telemetry-only fields evals reports ignore. */
export type LlmCall = Omit<ProviderCallRecord<LlmRole>, 'model' | 'completed'>;
