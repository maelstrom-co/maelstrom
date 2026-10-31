import type { Verdict } from '../../packages/evals/src/core/runtime/evaluate.js';
import {
  type SessionTurn,
  sessionAdapter,
} from '../../packages/evals/src/core/runtime/session.js';

export type Variant = 'current' | 'hourly' | 'weekly';
interface State {
  readonly instanceId: string;
  readonly variant: Variant;
}
interface Output extends State {
  readonly action: string;
}
type Turn = SessionTurn<State, Variant, Output>;
const actions: Record<Variant, string> = {
  current: 'showCurrent',
  hourly: 'showHourly',
  weekly: 'showWeekly',
};

/** Structural transition oracle for synthetic session evidence. */
export function scoreWeather(
  turns: readonly Turn[],
  expected: readonly Variant[],
  initialVariant: Variant = 'current',
): Verdict {
  const failures: string[] = [];
  if (turns.length !== expected.length) failures.push('Missing turns');
  for (const [index, variant] of expected.entries()) {
    const turn = turns[index];
    if (!turn) continue;
    if (turn.state.variant !== (expected[index - 1] ?? initialVariant))
      failures.push(`Turn ${index} lost prior state`);
    if (turn.index !== index || turn.input !== variant)
      failures.push(`Turn ${index} changed the sequence`);
    if (
      turn.state.instanceId !== turns[0]?.state.instanceId ||
      turn.resultingState.instanceId !== turns[0]?.state.instanceId ||
      turn.output.instanceId !== turns[0]?.state.instanceId
    )
      failures.push(`Turn ${index} changed target`);
    if (
      turn.output.variant !== variant ||
      turn.output.action !== actions[variant]
    )
      failures.push(`Turn ${index} wrong transition`);
    if (turn.resultingState.variant !== variant)
      failures.push(`Turn ${index} did not retain the resulting state`);
  }
  return { outcome: failures.length ? 'fail' : 'pass', failures };
}

/** Legacy-derived D15/D31 fixtures test the harness, not installed engine-old compatibility. */
export function legacyWeather(
  inputs: readonly Variant[],
  options: {
    readonly id?: string;
    readonly initialVariant?: Variant;
    readonly expected?: readonly Variant[];
    readonly fault?:
      | 'wrong-target'
      | 'wrong-action'
      | 'lost-state'
      | 'last-turn-lost-state';
    readonly failAt?: number;
  } = {},
) {
  return sessionAdapter<State, Variant, Output>({
    provenance:
      'synthetic legacy-derived D15/D31; scripted, engine-old unverified',
    inputs,
    initialize: (): State => ({
      instanceId: options.id ?? 'weather-main',
      variant: options.initialVariant ?? 'current',
    }),
    async step(variant, state, history, context) {
      if (history.length === options.failAt)
        throw new Error('Scripted later turn failure');
      if (
        history.length > 0 &&
        history.at(-1)?.output.variant !== state.variant
      )
        throw new Error('History/state mismatch');
      context.record({
        kind: 'diagnostic',
        producer: context.sampleKey,
        requestId: `turn-${history.length}`,
        value: { priorVariant: state.variant, historyLength: history.length },
      });
      const output: Output = {
        instanceId:
          options.fault === 'wrong-target'
            ? 'another-instance'
            : state.instanceId,
        variant,
        action:
          options.fault === 'wrong-action' ? 'invented' : actions[variant],
      };
      return {
        state: {
          ...state,
          variant:
            options.fault === 'lost-state'
              ? ('current' as const)
              : options.fault === 'last-turn-lost-state' &&
                  history.length === inputs.length - 1
                ? state.variant
                : variant,
        },
        output,
      };
    },
    score: (turns) =>
      scoreWeather(turns, options.expected ?? inputs, options.initialVariant),
  });
}
