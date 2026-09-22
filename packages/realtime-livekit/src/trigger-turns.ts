import type {
  AdapterVoiceActivation,
  VoiceActivationInput,
  VoiceInputAncestry,
} from '@maelstrom-co/realtime';
import type {
  CorrelatedTurnEnd,
  TriggerTurnResult,
} from '@maelstrom-co/realtime-protocol/livekit';

type Turn = {
  input: VoiceActivationInput;
  interrupted: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** Connection-owned source ledger; core remains the admission/order authority. */
export class TriggerTurns {
  readonly #turns = new Map<number, Turn>();
  readonly #unsubscribe: () => void;
  #ordinal = 0;
  #active: number | undefined;
  #closed = false;
  #draining = false;

  /**
   * Captures one connection policy and its validated drain-plus-delivery budget.
   * Release must synchronously acquire work ownership before returning; input
   * ownership is finished afterward. Interrupt runs at most once per admitted
   * source, including continuing speech released after a hook. Settled reports
   * terminal bookkeeping, not playback completion.
   */
  constructor(
    private readonly nonce: string,
    private readonly budgetMs: number,
    private readonly policy: AdapterVoiceActivation,
    private readonly interrupt: () => void,
    private readonly release: (
      text: string,
      ancestry: VoiceInputAncestry,
    ) => void,
    private readonly settled: () => void,
  ) {
    this.#unsubscribe = policy.onChange(() => this.#drain());
  }

  /** Reports actual transport start, including transported pre-roll in source time. */
  start(preRollMs = 0): void {
    if (this.#closed || this.#active !== undefined) return;
    const ordinal = ++this.#ordinal;
    this.#active = ordinal;
    const turn: Turn = {
      input: {
        id: `${this.nonce}-${ordinal}`,
        ordinal,
        start: Math.max(0, performance.now() - preRollMs),
        outcome: 'pending',
        reconciliationTimeoutMs: this.budgetMs,
      },
      interrupted: false,
    };
    this.#turns.set(ordinal, turn);
    this.policy.reportInput(turn.input);
  }

  /** Closes source speech; cancelled/local-drain-failed input is immediately ineligible. */
  end(cancelled = false): CorrelatedTurnEnd | undefined {
    const ordinal = this.#active;
    if (this.#closed || ordinal === undefined) return;
    this.#active = undefined;
    const turn = this.#turns.get(ordinal);
    if (!turn) return;
    turn.input = { ...turn.input, end: performance.now() };
    const error: TriggerTurnResult = {
      type: 'turn_result',
      version: 1,
      nonce: this.nonce,
      turnId: ordinal,
      outcome: 'error',
      text: '',
    };
    turn.timer = setTimeout(() => this.terminal(error), this.budgetMs);
    this.policy.reportInput(turn.input);
    if (cancelled) this.terminal(error);
    return {
      type: 'turn_end',
      version: 1,
      nonce: this.nonce,
      turnId: ordinal,
      cancelled,
    };
  }

  /** Applies one terminal to its original ended source; unknown/old/duplicate results are inert. */
  terminal(result: TriggerTurnResult): void {
    if (this.#closed || result.nonce !== this.nonce) return;
    const turn = this.#turns.get(result.turnId);
    if (
      !turn ||
      turn.input.end === undefined ||
      turn.input.outcome !== 'pending'
    )
      return;
    clearTimeout(turn.timer);
    turn.input = { ...turn.input, outcome: result.outcome, text: result.text };
    this.policy.reportInput(turn.input);
    this.#drain();
    if (!this.#closed) this.settled();
  }

  /** Drops private text and timers; stale policy callbacks cannot release held work. */
  close(): void {
    this.#closed = true;
    this.#unsubscribe();
    for (const turn of this.#turns.values()) clearTimeout(turn.timer);
    this.#turns.clear();
  }

  #drain(): void {
    if (this.#closed || this.#draining) return;
    this.#draining = true;
    try {
      for (const [ordinal, turn] of this.#turns) {
        const admission = this.policy.admission(turn.input.id);
        if (admission.status === 'admitted') {
          if (!turn.interrupted) {
            turn.interrupted = true;
            this.interrupt();
          }
          if (turn.input.outcome === 'success') {
            this.#turns.delete(ordinal);
            this.release(turn.input.text ?? '', admission.ancestry);
            this.policy.finishInput(turn.input.id);
          }
        } else if (
          admission.status === 'excluded' &&
          turn.input.outcome !== 'pending'
        ) {
          this.#turns.delete(ordinal);
        }
      }
    } finally {
      this.#draining = false;
    }
  }
}
