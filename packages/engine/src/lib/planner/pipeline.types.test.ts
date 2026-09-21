import { expect, test } from 'bun:test';
import { ok } from '@maelstrom-co/protocol';

import { buildGridResponse } from '../__test-helpers__/fixtures.js';
import { pipeline } from './pipeline.js';
import type {
  Planner,
  PlannerCandidate,
  PlanningInput,
  Stage,
} from './stage.js';

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

test('inline stages infer the intermediate type from the previous output', async () => {
  const planner = pipeline(
    async (input: PlanningInput) =>
      ok({ intent: input.request.context.updateReasons.length }),
    async (selection) =>
      ok(buildGridResponse({ userMessage: `reasons: ${selection.intent}` })),
  );

  expect(typeof adjacencyCases).toBe('function');
  expect(typeof planner).toBe('function');
});
