import type {
  JevActionPlan,
  JevSelection,
} from '@maelstrom-co/planner-jev/_eval';
import type { Scenario } from '../../core/scenarios.js';
import {
  compare,
  compareActions,
  expectedRetained,
  type Score,
} from '../../core/score.js';

/** Selection stage: visible and retained sets from jevSelect's output. */
export function scoreSelection(
  scenario: Scenario,
  selection: JevSelection,
): Score | undefined {
  if (!scenario.expected.visible) return undefined;
  const failures: string[] = [];
  compare(
    failures,
    'Selected visible',
    selection.instances
      .filter((i) => i.visible)
      .map((i) => i.instanceId)
      .sort(),
    [...scenario.expected.visible].sort(),
  );
  compare(
    failures,
    'Selected retained',
    selection.instances
      .filter((i) => i.decision !== 'delete')
      .map((i) => i.instanceId)
      .sort(),
    [...expectedRetained(scenario)].sort(),
  );
  return { pass: failures.length === 0, failures };
}

/**
 * Actions stage: ordered actions, bound parameters (a `stated_elsewhere`
 * slot counts when the expectation has a value for it, since the LLM fills
 * it later) and the asks.
 */
export function scoreActions(
  scenario: Scenario,
  plan: JevActionPlan,
): Score | undefined {
  const { actions, asks } = scenario.expected;
  if (!actions && !asks) return undefined;
  const failures: string[] = [];
  if (actions) {
    const planned = plan.actions.map((action) => {
      const expected = actions.find(
        (candidate) =>
          candidate.instanceId === action.instanceId &&
          candidate.action === action.action,
      );
      const params: Record<string, unknown> = { ...action.params };
      for (const slot of action.pending)
        params[slot.name] = expected?.params?.[slot.name] ?? '(pending)';
      return {
        instanceId: String(action.instanceId),
        action: String(action.action),
        ...(Object.keys(params).length > 0 && { params }),
      };
    });
    compareActions(failures, planned, actions);
  }
  compare(
    failures,
    'Asks',
    plan.asks
      .map((ask) => `${ask.instanceId}.${ask.action}.${ask.parameter.name}`)
      .sort(),
    (asks ?? [])
      .map((ask) => `${ask.instanceId}.${ask.action}.${ask.parameter}`)
      .sort(),
    (actual, wanted) => wanted.every((ask) => actual.includes(ask)),
  );
  return { pass: failures.length === 0, failures };
}
