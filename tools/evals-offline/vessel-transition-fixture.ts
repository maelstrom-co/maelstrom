import {
  type TransitionInstance,
  transitionDataSchema,
  transitionDestination,
  transitionExpectationsSchema,
  transitionInputsSchema,
  type VesselTransitionData,
  type VesselTransitionExpectations,
  type VesselTransitionInput,
} from '../../packages/evals/src/adapters/legacy-vessel-transition.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

interface TransitionState {
  readonly instances: readonly TransitionInstance[];
}
interface TransitionOutput extends TransitionState {
  readonly executionPlan: readonly {
    readonly instanceId: string;
    readonly action: string;
  }[];
}
export type VesselTransitionTurn = SessionTurn<
  TransitionState,
  VesselTransitionInput,
  TransitionOutput
>;

function sameInstances(
  actual: readonly TransitionInstance[],
  expected: readonly TransitionInstance[],
): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual.map((item) => item.instanceId)).size === actual.length &&
    expected.every((item) =>
      actual.some(
        (candidate) =>
          candidate.instanceId === item.instanceId &&
          candidate.vesselId === item.vesselId &&
          candidate.variant === item.variant,
      ),
    )
  );
}

/** Checks response and retained state independently; extra/lost/changed Instances fail. */
export function scoreVesselTransition(
  turns: readonly VesselTransitionTurn[],
  initial: readonly TransitionInstance[],
  input: VesselTransitionInput,
  expected: VesselTransitionExpectations,
): Verdict {
  const failures: string[] = [];
  const turn = turns[0];
  if (turns.length !== 1 || !turn)
    return {
      outcome: 'fail',
      failures: ['Expected exactly one completed turn'],
    };
  if (
    turn.index !== 0 ||
    turn.input.intent !== input.intent ||
    turn.input.instanceId !== input.instanceId ||
    turn.input.action !== input.action
  )
    failures.push('Changed input or turn sequence');
  if (!sameInstances(turn.state.instances, initial))
    failures.push('Changed initial state');
  const plan = turn.output.executionPlan;
  if (
    plan.length !== 1 ||
    plan[0]?.instanceId !== expected.instanceId ||
    plan[0]?.action !== expected.action ||
    plan[0]?.instanceId !== input.instanceId ||
    plan[0]?.action !== input.action
  )
    failures.push('Wrong Action or target');
  if (
    !initial.some((item) => item.instanceId === expected.instanceId) ||
    expected.instanceId !== input.instanceId
  )
    failures.push('Expected target does not match initial Instance');
  const final = initial.map((item) =>
    item.instanceId === expected.instanceId
      ? { ...item, variant: expected.variant }
      : item,
  );
  if (!sameInstances(turn.output.instances, final))
    failures.push('Wrong response state or changed unrelated Instance');
  if (!sameInstances(turn.resultingState.instances, final))
    failures.push('Wrong retained state or changed unrelated Instance');
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Synthetic transition interpreter, not Engine planning, UI application, or lab upload. */
export function legacyVesselTransition(
  fixture: VesselTransitionData,
  inputs: VesselTransitionInput,
  expectations: VesselTransitionExpectations,
) {
  const data = transitionDataSchema.parse(fixture);
  const input = transitionInputsSchema.parse(inputs);
  const expected = transitionExpectationsSchema.parse(expectations);
  transitionDestination(data, input);
  return sessionAdapter<
    TransitionState,
    VesselTransitionInput,
    TransitionOutput
  >({
    provenance:
      'synthetic legacy-derived vessel transition; scripted, engine-old unverified',
    inputs: [input],
    initialize: () => ({ instances: data.instances }),
    async step(stimulus, state) {
      const destination = transitionDestination(
        { ...data, instances: [...state.instances] },
        stimulus,
      );
      const instances = state.instances.map((item) =>
        item.instanceId === stimulus.instanceId
          ? { ...item, variant: destination }
          : item,
      );
      return {
        state: { instances },
        output: {
          instances,
          executionPlan: [
            { instanceId: stimulus.instanceId, action: stimulus.action },
          ],
        },
      };
    },
    score: (turns) =>
      scoreVesselTransition(turns, data.instances, input, expected),
  });
}
