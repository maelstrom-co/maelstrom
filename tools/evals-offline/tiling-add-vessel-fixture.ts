import {
  strictTilingLayoutFailures,
  type TilingAddData,
  type TilingAddExpectations,
  type TilingAddInput,
  type TilingAddResponse,
  type TilingAddState,
  tilingAddDataSchema,
  tilingAddExpectationsSchema,
  tilingAddInputsSchema,
  tilingAddObservationSchema,
} from '../../packages/evals/src/adapters/legacy-tiling-add-vessel.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** One complete synthetic addition, not client creation or rendering evidence. */
export type TilingAddTurn = SessionTurn<
  TilingAddState,
  TilingAddInput,
  TilingAddResponse
>;

function sameInstances(
  actual: TilingAddState['layout']['instances'],
  expected: TilingAddState['layout']['instances'],
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

/** Strict weighted-tree/add-and-retain rubric; no Execution Plan semantics are scored. */
export function scoreTilingAddVessel(
  turns: unknown,
  data: TilingAddData,
  input: TilingAddInput,
  expected: TilingAddExpectations,
): Verdict {
  const parsed = tilingAddObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected one complete, structurally valid turn'],
    };
  const turn = parsed.data[0];
  const failures: string[] = [];
  if (turn.input.intent !== input.intent)
    failures.push('Changed request evidence');
  if (!sameInstances(data.initial.layout.instances, expected.retainedInstances))
    failures.push('Expected retained Instances do not match the initial scene');
  if (
    data.initial.layout.instances.some(
      (item) => item.instanceId === expected.addedInstance.instanceId,
    )
  )
    failures.push('Added Calendar identity is not fresh');
  if (
    !sameInstances(turn.state.layout.instances, data.initial.layout.instances)
  )
    failures.push('Changed initial Instance state');
  failures.push(
    ...strictTilingLayoutFailures(turn.state.layout).map(
      (failure) => `Initial state: ${failure}`,
    ),
  );
  const final = [...expected.retainedInstances, expected.addedInstance];
  for (const [label, state] of [
    ['Response', turn.output],
    ['Retained state', turn.resultingState],
  ] as const) {
    if (!sameInstances(state.layout.instances, final))
      failures.push(
        `${label} must retain Weather/Labs and add exactly the fresh Calendar/month`,
      );
    failures.push(
      ...strictTilingLayoutFailures(state.layout).map(
        (failure) => `${label}: ${failure}`,
      ),
    );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent scripts without invoking a planner, renderer or Action handler. */
export function legacyTilingAddVessel(
  fixture: TilingAddData,
  request: TilingAddInput,
  expectations: TilingAddExpectations,
) {
  const data = tilingAddDataSchema.parse(fixture);
  const input = tilingAddInputsSchema.parse(request);
  const expected = tilingAddExpectationsSchema.parse(expectations);
  return sessionAdapter<TilingAddState, TilingAddInput, TilingAddResponse>({
    provenance:
      'synthetic legacy-derived D37 addition; strict current weighted tree, runtime repair and engine-old unverified',
    inputs: [input],
    initialize: () => data.initial,
    async step() {
      const response = structuredClone(data.response);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreTilingAddVessel(turns, data, input, expected),
  });
}
