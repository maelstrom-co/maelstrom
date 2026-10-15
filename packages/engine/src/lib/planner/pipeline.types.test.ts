import { expect, test } from 'bun:test';
import type {
  GridResponse,
  NeedsClarification,
  TilingResponse,
} from '@maelstrom-co/protocol';
import { ok } from '@maelstrom-co/protocol';

import { buildGridResponse } from '../__test-helpers__/fixtures.js';
import type { EngineConfig } from '../config.js';
import type { PlannerCandidate, PlannerOutput } from './candidate.js';
import { pipeline } from './pipeline.js';
import type {
  ClarifyingPlanner,
  Planner,
  PlanningInput,
  Retryable,
  Stage,
} from './stage.js';
import { withFallback } from './with-fallback.js';
import { withRetry } from './with-retry.js';

interface Selection {
  readonly vesselIds: readonly string[];
}
interface Arrangement {
  readonly rows: number;
}

declare const select: Stage<PlanningInput, Selection>;
declare const arrange: Stage<Selection, Arrangement>;
declare const render: Stage<Arrangement, PlannerCandidate>;
declare const renderSelection: Stage<Selection, PlannerCandidate>;

// Compiled by `typecheck` (tsconfig.spec.json); never executed.
function adjacencyCases(): Planner[] {
  return [
    pipeline(select, renderSelection),
    pipeline(select, arrange, render),
    // @ts-expect-error adjacent stages disagree: Selection is not Arrangement
    pipeline(select, render),
    // @ts-expect-error the last stage must produce a PlannerCandidate
    pipeline(select, arrange),
    // @ts-expect-error the first stage must accept PlanningInput
    pipeline(arrange, render),
    // @ts-expect-error a middle mismatch in a longer chain is caught too
    pipeline(select, arrange, arrange, render),
  ];
}

declare const strictGrid: GridResponse;
declare const strictTiling: TilingResponse;
declare const existingPlanner: Planner;
declare const existingRetryable: Stage<
  Retryable<PlanningInput>,
  PlannerCandidate
>;
declare const clarifyingPlanner: ClarifyingPlanner;
declare const clarifyingRetryable: Stage<
  Retryable<PlanningInput>,
  PlannerOutput
>;
declare const clarification: NeedsClarification;

// Compiled by `typecheck`; never executed. Planners written against the
// reply-bearing output keep their types and still fit every Engine seam,
// clarifying planners fit the Engine and survive withRetry and withFallback
// as clarifying planners, and the ts-expect-error lines pin what must stay
// rejected: a clarification is neither a Planner result nor a candidate.
function plannerSeamTypeCases(): unknown[] {
  const fromGrid: PlannerCandidate = strictGrid;
  const fromTiling: PlannerCandidate = strictTiling;
  const configured: EngineConfig['planner'] = existingPlanner;
  const retried: Stage<PlanningInput, PlannerCandidate> = withRetry(
    existingRetryable,
    { max: 1 },
  );
  const fellBack: Planner = withFallback(existingPlanner, existingPlanner);
  const asOutput: PlannerOutput = clarification;
  const clarifyingConfigured: EngineConfig['planner'] = clarifyingPlanner;
  // @ts-expect-error a clarifying planner is not a reply-only Planner
  const narrowed: Planner = clarifyingPlanner;
  // @ts-expect-error a needs-clarification result is not a layout candidate
  const notCandidate: PlannerCandidate = clarification;
  const clarifyingRetried: ClarifyingPlanner = withRetry(clarifyingRetryable, {
    max: 1,
  });
  const clarifyingFellBack: ClarifyingPlanner = withFallback(
    clarifyingPlanner,
    clarifyingPlanner,
  );
  // @ts-expect-error a retried clarifying planner is not a reply-only Planner
  const retriedNarrowed: Planner = withRetry(clarifyingRetryable, { max: 1 });
  return [
    fromGrid,
    fromTiling,
    configured,
    retried,
    fellBack,
    asOutput,
    clarifyingConfigured,
    narrowed,
    notCandidate,
    clarifyingRetried,
    clarifyingFellBack,
    retriedNarrowed,
  ];
}

test('inline stages infer the intermediate type from the previous output', async () => {
  const planner = pipeline(
    async (input: PlanningInput) =>
      ok({ intent: input.request.context.updateReasons.length }),
    async (selection) =>
      ok(buildGridResponse({ userMessage: `reasons: ${selection.intent}` })),
  );

  expect(typeof adjacencyCases).toBe('function');
  expect(typeof plannerSeamTypeCases).toBe('function');
  expect(typeof planner).toBe('function');
});
