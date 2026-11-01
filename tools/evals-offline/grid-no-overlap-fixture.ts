import {
  type GridNoOverlapData,
  type GridNoOverlapExpectations,
  type GridNoOverlapInput,
  type GridNoOverlapResponse,
  type GridNoOverlapState,
  gridNoOverlapDataSchema,
  gridNoOverlapExpectationsSchema,
  gridNoOverlapInputsSchema,
  gridNoOverlapLayoutFailures,
  gridNoOverlapObservationSchema,
} from '../../packages/evals/src/adapters/legacy-grid-no-overlap.js';
import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

/** Complete synthetic grid evidence, not client layout application or rendering. */
export type GridNoOverlapTurn = SessionTurn<
  GridNoOverlapState,
  GridNoOverlapInput,
  GridNoOverlapResponse
>;

function samePositions(
  actual: GridNoOverlapState['layout'],
  expected: GridNoOverlapState['layout'],
): boolean {
  return (
    actual.type === expected.type &&
    actual.positions.length === expected.positions.length &&
    new Set(actual.positions.map((item) => item.instanceId)).size ===
      actual.positions.length &&
    expected.positions.every((item) =>
      actual.positions.some(
        (candidate) =>
          candidate.instanceId === item.instanceId &&
          candidate.position.row === item.position.row &&
          candidate.position.column === item.position.column &&
          candidate.size.width === item.size.width &&
          candidate.size.height === item.size.height,
      ),
    )
  );
}

/** Exact visibility, integer cells, bounds and overlap only; plans and compactness are unscored. */
export function scoreGridNoOverlap(
  turns: unknown,
  data: GridNoOverlapData,
  input: GridNoOverlapInput,
  expected: GridNoOverlapExpectations,
): Verdict {
  const parsed = gridNoOverlapObservationSchema.safeParse(turns);
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
    data.chartDimensions.rows !== expected.chartDimensions.rows ||
    data.chartDimensions.columns !== expected.chartDimensions.columns
  )
    failures.push('Expected Chart dimensions do not match the fixture');
  if (
    !data.instances.every((item) =>
      expected.instanceIds.includes(item.instanceId),
    )
  )
    failures.push(
      'Expected identities do not match the known fixture Instances',
    );
  if (!samePositions(turn.state.layout, data.initial.layout))
    failures.push('Changed initial grid evidence');
  for (const [label, state] of [
    ['Initial state', turn.state],
    ['Response', turn.output],
    ['Retained state', turn.resultingState],
  ] as const) {
    failures.push(
      ...gridNoOverlapLayoutFailures(state.layout, expected).map(
        (reason) => `${label}: ${reason}`,
      ),
    );
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Copies independent scripts without invoking an Engine, planner scorer, renderer or judge. */
export function legacyGridNoOverlap(
  fixture: GridNoOverlapData,
  request: GridNoOverlapInput,
  expectations: GridNoOverlapExpectations,
) {
  const data = gridNoOverlapDataSchema.parse(fixture);
  const input = gridNoOverlapInputsSchema.parse(request);
  const expected = gridNoOverlapExpectationsSchema.parse(expectations);
  return sessionAdapter<
    GridNoOverlapState,
    GridNoOverlapInput,
    GridNoOverlapResponse
  >({
    provenance:
      'synthetic legacy-derived D13 grid allocation; compactness, minimum-size fit and engine-old unverified',
    inputs: [input],
    initialize: () => data.initial,
    async step() {
      const response = structuredClone(data.response);
      return {
        output: response,
        state: { layout: structuredClone(response.layout) },
      };
    },
    score: (turns) => scoreGridNoOverlap(turns, data, input, expected),
  });
}
