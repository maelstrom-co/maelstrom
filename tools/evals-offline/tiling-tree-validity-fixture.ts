import {
  strictBinaryTilingLayoutFailures,
  type TilingTreeData,
  type TilingTreeExpectations,
  type TilingTreeInput,
  type TilingTreeResponse,
  type TilingTreeState,
  tilingTreeDataSchema,
  tilingTreeExpectationsSchema,
  tilingTreeInputsSchema,
  tilingTreeObservationSchema,
} from '../../packages/evals/src/adapters/legacy-tiling-tree-validity.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** One complete synthetic Labs addition, not client or renderer evidence. */
export type TilingTreeTurn = SessionTurn<
  TilingTreeState,
  TilingTreeInput,
  TilingTreeResponse
>;

function sameInstances(
  actual: TilingTreeState['layout']['instances'],
  expected: TilingTreeState['layout']['instances'],
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

/** Strict binary coverage and add/retain rubric; no Execution Plan semantics are scored. */
export function scoreTilingTreeValidity(
  turns: unknown,
  data: TilingTreeData,
  input: TilingTreeInput,
  expected: TilingTreeExpectations,
): Verdict {
  const parsed = tilingTreeObservationSchema.safeParse(turns);
  if (!parsed.success)
    return {
      outcome: 'fail',
      failures: ['Expected one complete, structurally valid turn'],
    };
  const turn = parsed.data[0];
  const failures: string[] = [];
  if (turn.input.intent !== input.intent)
    failures.push('Changed request evidence');
  if (
    !sameInstances(data.initial.layout.instances, [expected.retainedInstance])
  )
    failures.push('Expected retained Weather does not match the initial scene');
  if (
    data.initial.layout.instances.some(
      (item) => item.instanceId === expected.addedInstance.instanceId,
    )
  )
    failures.push('Added Labs identity is not fresh');
  if (
    !sameInstances(turn.state.layout.instances, data.initial.layout.instances)
  )
    failures.push('Changed initial Instance state');
  failures.push(
    ...strictBinaryTilingLayoutFailures(turn.state.layout).map(
      (failure) => `Initial state: ${failure}`,
    ),
  );
  const final = [expected.retainedInstance, expected.addedInstance];
  for (const [label, state] of [
    ['Response', turn.output],
    ['Retained state', turn.resultingState],
  ] as const) {
    if (!sameInstances(state.layout.instances, final))
      failures.push(
        `${label} must retain Weather/current and add exactly the fresh Labs/trends`,
      );
    failures.push(
      ...strictBinaryTilingLayoutFailures(state.layout).map(
        (failure) => `${label}: ${failure}`,
      ),
    );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent scripts without invoking a planner, judge, renderer or handler. */
export function legacyTilingTreeValidity(
  fixture: TilingTreeData,
  request: TilingTreeInput,
  expectations: TilingTreeExpectations,
) {
  const data = tilingTreeDataSchema.parse(fixture);
  const input = tilingTreeInputsSchema.parse(request);
  const expected = tilingTreeExpectationsSchema.parse(expectations);
  return sessionAdapter<TilingTreeState, TilingTreeInput, TilingTreeResponse>({
    provenance:
      'synthetic legacy-derived D12 binary tree; strengthened current-format rubric, depth parity and engine-old unverified',
    inputs: [input],
    initialize: () => data.initial,
    async step() {
      const response = structuredClone(data.response);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreTilingTreeValidity(turns, data, input, expected),
  });
}
