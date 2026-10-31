import type {
  EvaluationAdapter,
  EvaluationContext,
  Verdict,
} from './evaluate.js';

/** A completed turn snapshots both sides of the state transition and its output. */
export interface SessionTurn<State, Input, Output> {
  readonly index: number;
  readonly state: State;
  /** State retained for the next turn, including the final turn's state. */
  readonly resultingState: State;
  readonly input: Input;
  readonly output: Output;
}

/** A session adapter owns state; the lifecycle owns sample identity and evidence. */
export function sessionAdapter<State, Input, Output>(options: {
  readonly provenance: string;
  readonly inputs: readonly Input[];
  readonly initialize: () => State;
  readonly step: (
    input: Input,
    state: State,
    history: readonly SessionTurn<State, Input, Output>[],
    context: EvaluationContext,
  ) => Promise<{ readonly state: State; readonly output: Output }>;
  readonly score: (
    turns: readonly SessionTurn<State, Input, Output>[],
  ) => Verdict;
}): EvaluationAdapter<readonly SessionTurn<State, Input, Output>[]> {
  return {
    surface: 'session',
    provenance: options.provenance,
    preflight() {
      if (options.inputs.length === 0)
        throw new Error('Session requires at least one turn');
    },
    async execute(context) {
      let state = structuredClone(options.initialize());
      const turns: SessionTurn<State, Input, Output>[] = [];
      for (const input of options.inputs) {
        const before = structuredClone(state);
        const result = await options.step(
          structuredClone(input),
          structuredClone(state),
          structuredClone(turns),
          context,
        );
        const turn = {
          index: turns.length,
          state: before,
          resultingState: structuredClone(result.state),
          input: structuredClone(input),
          output: structuredClone(result.output),
        };
        turns.push(turn);
        context.record({ kind: 'turn', value: turn });
        state = structuredClone(turn.resultingState);
      }
      return { disposition: 'planned', completeness: 'complete', value: turns };
    },
    score: options.score,
  };
}
