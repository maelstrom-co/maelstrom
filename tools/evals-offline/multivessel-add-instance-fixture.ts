import {
  type MultivesselAddData,
  type MultivesselAddExpectations,
  type MultivesselAddInputs,
  type MultivesselAddResponse,
  type MultivesselAddState,
  multivesselAddDataSchema,
  multivesselAddExpectationsSchema,
  multivesselAddInputsSchema,
  multivesselAddObservationSchema,
} from '../../packages/evals/src/adapters/legacy-multivessel-add-instance.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Complete response evidence; snapshots do not prove layout-before-Action application. */
export type MultivesselAddTurn = SessionTurn<
  MultivesselAddState,
  MultivesselAddInputs['turns'][number],
  MultivesselAddResponse
>;

/** Strengthened identity/preservation checks; Action semantics and extra membership are unscored. */
export function scoreMultivesselAddInstance(
  turns: unknown,
  data: MultivesselAddData,
  inputs: MultivesselAddInputs,
  expected: MultivesselAddExpectations,
): Verdict {
  const parsed = multivesselAddObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected two complete, structurally valid turns'],
    };
  const failures: string[] = [];
  const retained = expected.retainedInstance;
  const added = expected.addedInstance;
  const initial = data.initial.layout.instances[0];
  if (
    initial?.instanceId !== retained.instanceId ||
    initial.vesselId !== retained.vesselId ||
    initial.variant !== retained.variant
  )
    failures.push(
      'Expected Weather does not match the original fixture Instance',
    );
  if (
    data.initial.layout.instances.some(
      (item) => item.instanceId === added.instanceId,
    )
  )
    failures.push('Expected Calendar identity is not fresh');
  for (const [index, turn] of parsed.data.entries()) {
    if (
      turn.index !== index ||
      turn.input.intent !== inputs.turns[index]?.intent
    )
      failures.push(`Turn ${index} changed prompt or sequence`);
    const response = turn.output;
    if (response.layout.type !== 'tiling')
      failures.push(`Turn ${index} requires tiling layout evidence`);
    // First-match semantics deliberately leave duplicate/extra membership unscored.
    const weather = response.layout.instances.find(
      (item) => item.instanceId === retained.instanceId,
    );
    if (
      !weather ||
      weather.vesselId !== retained.vesselId ||
      weather.variant !== retained.variant
    )
      failures.push(`Turn ${index} did not preserve original Weather/current`);
    const calendar = response.layout.instances.find(
      (item) => item.instanceId === added.instanceId,
    );
    if (!calendar || calendar.vesselId !== added.vesselId)
      failures.push(`Turn ${index} is missing the selected Calendar Instance`);
    else if (index === 1 && calendar.variant !== added.finalVariant)
      failures.push('Turn 1 Calendar must be month');
    if (
      index === 0 &&
      !response.executionPlan.some(
        (step) => step.instanceId === added.instanceId,
      )
    )
      failures.push('Turn 0 is missing an Action targeting the added Calendar');
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent scripts; no Engine, client application or Action handler is invoked. */
export function legacyMultivesselAddInstance(
  fixture: MultivesselAddData,
  requests: MultivesselAddInputs,
  expectations: MultivesselAddExpectations,
) {
  const data = multivesselAddDataSchema.parse(fixture);
  const inputs = multivesselAddInputsSchema.parse(requests);
  const expected = multivesselAddExpectationsSchema.parse(expectations);
  return sessionAdapter<
    MultivesselAddState,
    MultivesselAddInputs['turns'][number],
    MultivesselAddResponse
  >({
    provenance:
      'synthetic legacy-derived D34 Calendar addition; strengthened identity/preservation, handler ordering and engine-old unverified',
    inputs: inputs.turns,
    initialize: () => data.initial,
    async step(_input, _state, history) {
      const response = structuredClone(data.responses[history.length]);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) =>
      scoreMultivesselAddInstance(turns, data, inputs, expected),
  });
}
