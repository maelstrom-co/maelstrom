import {
  type NoDualTargetPlanData,
  type NoDualTargetPlanExpectations,
  type NoDualTargetPlanInputs,
  type NoDualTargetPlanResponse,
  type NoDualTargetPlanState,
  noDualTargetPlanDataSchema,
  noDualTargetPlanExpectationsSchema,
  noDualTargetPlanInputsSchema,
  noDualTargetPlanObservationSchema,
} from '../../packages/evals/src/adapters/legacy-no-dual-target-plan.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** One complete synthetic response, without layout or Action effects. */
export type NoDualTargetPlanTurn = SessionTurn<
  NoDualTargetPlanState,
  NoDualTargetPlanInputs,
  NoDualTargetPlanResponse
>;

/** Complete D17 target-exclusion predicate only: both protected target IDs must not occur in the Execution Plan. */
export function scoreNoDualTargetPlan(
  turns: unknown,
  input: NoDualTargetPlanInputs,
): Verdict {
  const parsed = noDualTargetPlanObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: [
        'Expected one complete, bounded response with an Execution Plan',
      ],
    };
  const turn = parsed.data[0];
  if (turn.input.intent !== input.intent)
    return { outcome: 'fail', failures: ['Changed input prompt'] };
  const targets = new Set(
    turn.output.executionPlan.map((step) => step.instanceId),
  );
  const failures =
    targets.has('weather-main') && targets.has('calendar-main')
      ? ['Execution Plan contains both weather-main and calendar-main']
      : [];
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent scripts; does not interpret text, apply layouts or execute handlers. */
export function legacyNoDualTargetPlan(
  fixture: NoDualTargetPlanData,
  requests: NoDualTargetPlanInputs,
  expectations: NoDualTargetPlanExpectations,
) {
  const data = noDualTargetPlanDataSchema.parse(fixture);
  const input = noDualTargetPlanInputsSchema.parse(requests);
  noDualTargetPlanExpectationsSchema.parse(expectations);
  return sessionAdapter<
    NoDualTargetPlanState,
    NoDualTargetPlanInputs,
    NoDualTargetPlanResponse
  >({
    provenance:
      'synthetic legacy-derived COMPLETE D17 no-dual-target-plan; clarification and whole-response safety are outside this predicate; engine-old unverified',
    inputs: [input],
    initialize: () => data.initial,
    async step(_input, state) {
      return { state, output: structuredClone(data.response) };
    },
    score: (turns) => scoreNoDualTargetPlan(turns, input),
  });
}
