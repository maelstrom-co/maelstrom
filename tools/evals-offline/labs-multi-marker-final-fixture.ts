import {
  type LabsMultiMarkerFinalData,
  type LabsMultiMarkerFinalExpectations,
  type LabsMultiMarkerFinalInputs,
  type LabsMultiMarkerFinalResponse,
  type LabsMultiMarkerFinalState,
  labsMultiMarkerFinalDataSchema,
  labsMultiMarkerFinalExpectationsSchema,
  labsMultiMarkerFinalInputsSchema,
  labsMultiMarkerFinalObservationSchema,
} from '../../packages/evals/src/adapters/legacy-labs-multi-marker-final.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Complete synthetic evidence, without selected-marker state. */
export type LabsMultiMarkerFinalTurn = SessionTurn<
  LabsMultiMarkerFinalState,
  LabsMultiMarkerFinalInputs['turns'][number],
  LabsMultiMarkerFinalResponse
>;

/** Contains-only final Action check; additional conflicting selections remain unscored. */
export function scoreLabsMultiMarkerFinal(
  turns: unknown,
  inputs: LabsMultiMarkerFinalInputs,
  expected: LabsMultiMarkerFinalExpectations,
): Verdict {
  const parsed = labsMultiMarkerFinalObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected three complete, structurally valid turns'],
    };
  const failures: string[] = [];
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
  }
  if (
    !parsed.data[2].output.executionPlan.some((step) => {
      const slugs = step.params?.markerSlugs;
      return (
        step.instanceId === expected.instanceId &&
        step.action === expected.action &&
        Array.isArray(slugs) &&
        slugs.length === 3 &&
        slugs.every((slug) => typeof slug === 'string') &&
        new Set(slugs).size === 3 &&
        expected.markerSlugs.every((slug) => slugs.includes(slug))
      );
    })
  )
    failures.push('Turn 2 is missing the exact-set marker selection Action');
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent responses; no model, Engine or Action handler is executed. */
export function legacyLabsMultiMarkerFinal(
  fixture: LabsMultiMarkerFinalData,
  requests: LabsMultiMarkerFinalInputs,
  expectations: LabsMultiMarkerFinalExpectations,
) {
  const data = labsMultiMarkerFinalDataSchema.parse(fixture);
  const inputs = labsMultiMarkerFinalInputsSchema.parse(requests);
  const expected = labsMultiMarkerFinalExpectationsSchema.parse(expectations);
  return sessionAdapter<
    LabsMultiMarkerFinalState,
    LabsMultiMarkerFinalInputs['turns'][number],
    LabsMultiMarkerFinalResponse
  >({
    provenance:
      'synthetic legacy-derived D30 final marker Action emission; F03b timing corrected, exact-set strengthened; no handler or legacy-runtime verification',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreLabsMultiMarkerFinal(turns, inputs, expected),
  });
}
