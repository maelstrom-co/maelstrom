import type { ReportedLlmUsage } from '@maelstrom-co/telemetry/usage';
import type { ProviderCallRecord } from '@maelstrom-co/telemetry/usage-adapter';

// Reports read this role-labelled sink, not planner `llm.call` events, so usage is not counted twice.
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

/** One provider call labelled with the LLM role it served. */
export type LlmCall = ProviderCallRecord<LlmRole>;
