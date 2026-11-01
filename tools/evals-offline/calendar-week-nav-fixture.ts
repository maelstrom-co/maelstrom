import {
  type CalendarWeekNavData,
  type CalendarWeekNavExpectations,
  type CalendarWeekNavInput,
  type CalendarWeekNavInputs,
  type CalendarWeekNavResponse,
  type CalendarWeekNavState,
  calendarWeekNavDataSchema,
  calendarWeekNavExpectationsSchema,
  calendarWeekNavInputsSchema,
  calendarWeekNavObservationSchema,
} from '../../packages/evals/src/adapters/legacy-calendar-week-nav.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Complete snapshots without a retained-state continuity guarantee. */
export type CalendarWeekNavTurn = SessionTurn<
  CalendarWeekNavState,
  CalendarWeekNavInput,
  CalendarWeekNavResponse
>;

/** Source-scoring contains checks, not exact plan or layout membership checks. */
export function scoreCalendarWeekNav(
  turns: unknown,
  inputs: CalendarWeekNavInputs,
  expected: CalendarWeekNavExpectations,
): Verdict {
  const parsed = calendarWeekNavObservationSchema.safeParse(turns);
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
    const response = turn.output;
    if (index === 1) {
      if (response.executionPlan.length !== 0)
        failures.push('Turn 1 must have an empty Execution Plan');
    } else {
      const action =
        index === 0 ? expected.weeklyAction : expected.monthlyAction;
      if (
        !response.executionPlan.some(
          (step) =>
            step.instanceId === expected.instanceId && step.action === action,
        )
      )
        failures.push(`Turn ${index} is missing the expected ${action} Action`);
    }
    if (response.layout.type !== 'tiling')
      failures.push(`Turn ${index} requires tiling layout evidence`);
    const target = response.layout.instances.find(
      (item) => item.instanceId === expected.instanceId,
    );
    const variant =
      index === 2 ? expected.monthlyVariant : expected.weeklyVariant;
    if (!target || target.variant !== variant)
      failures.push(
        `Turn ${index} is missing the expected ${variant} Instance`,
      );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies scripts without interpreting prompts, executing Actions or calling a judge. */
export function legacyCalendarWeekNav(
  fixture: CalendarWeekNavData,
  requests: CalendarWeekNavInputs,
  expectations: CalendarWeekNavExpectations,
) {
  const data = calendarWeekNavDataSchema.parse(fixture);
  const inputs = calendarWeekNavInputsSchema.parse(requests);
  const expected = calendarWeekNavExpectationsSchema.parse(expectations);
  return sessionAdapter<
    CalendarWeekNavState,
    CalendarWeekNavInput,
    CalendarWeekNavResponse
  >({
    provenance:
      'synthetic legacy-derived D29 Calendar round trip; source-scoring script, engine-old unverified',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreCalendarWeekNav(turns, inputs, expected),
  });
}
