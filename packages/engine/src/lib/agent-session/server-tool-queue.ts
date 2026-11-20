/** How a {@link ServerToolQueue.run} call ended. */
export type ServerToolQueueOutcome<T> =
  | {
      /** The call reached its slot and executed. */
      readonly type: 'ran';
      /** What the call's `execute` resolved to. */
      readonly value: T;
    }
  | {
      /** The run's signal aborted before the call's slot came up. */
      readonly type: 'released';
    };

/**
 * FIFO queue that runs one Agent Run's Server Tools one at a time in the
 * order the model wrote them, while `chat()` itself runs tools in parallel.
 * Slots are reserved in call order before any call starts, so the order does
 * not depend on when each call reaches its executor.
 */
export interface ServerToolQueue {
  /**
   * Records a slot for the call behind every slot reserved before it.
   * Reserving a call twice keeps its first slot.
   */
  reserve(callId: string): void;
  /**
   * Waits until every earlier slot has finished, then executes the call. Its
   * slot stays held after `execute` resolves, until {@link finish} frees it,
   * so the caller can report the call's outcome before the next call starts.
   * A call without a reservation takes the next slot now. When the signal
   * aborts before the slot comes up, `execute` never runs, the slot is freed
   * and the call resolves as `released`. A rejection of `execute` frees the
   * slot and passes through.
   */
  run<T>(
    callId: string,
    execute: () => Promise<T>,
  ): Promise<ServerToolQueueOutcome<T>>;
  /**
   * Frees the call's slot so the next call can start. Ignores a call with no
   * slot, such as one already freed or never reserved.
   */
  finish(callId: string): void;
  /**
   * Resolves once no slot is reserved, waiting or running, at once when the
   * queue is already idle. An abort releases every slot, so this never
   * waits on a call that will not start.
   */
  whenIdle(): Promise<void>;
}

/**
 * Creates the {@link ServerToolQueue} of one Agent Run.
 *
 * @param signal - The run's abort signal. Its abort releases every slot.
 */
export function createServerToolQueue(signal: AbortSignal): ServerToolQueue {
  const slots = new Map<string, Slot>();
  const idleWaiters: (() => void)[] = [];
  let tail: Promise<void> = Promise.resolve();
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  void aborted.then(() => {
    for (const slot of [...slots.values()]) release(slot);
  });

  return {
    reserve(callId) {
      slotFor(callId);
    },
    async run(callId, execute) {
      const slot = slotFor(callId);
      await Promise.race([slot.turn, aborted]);
      if (signal.aborted) {
        release(slot);
        return { type: 'released' };
      }
      try {
        return { type: 'ran', value: await execute() };
      } catch (error) {
        release(slot);
        throw error;
      }
    },
    finish(callId) {
      const slot = slots.get(callId);
      if (slot !== undefined) release(slot);
    },
    whenIdle() {
      if (slots.size === 0) return Promise.resolve();
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
      });
    },
  };

  function slotFor(callId: string): Slot {
    const existing = slots.get(callId);
    if (existing !== undefined) return existing;
    let openNext!: () => void;
    const finished = new Promise<void>((resolve) => {
      openNext = resolve;
    });
    const slot: Slot = { callId, turn: tail, openNext };
    tail = finished;
    if (!signal.aborted) slots.set(callId, slot);
    return slot;
  }

  function release(slot: Slot) {
    slot.openNext();
    if (slots.get(slot.callId) !== slot) return;
    slots.delete(slot.callId);
    if (slots.size > 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }
}

interface Slot {
  readonly callId: string;
  readonly turn: Promise<void>;
  readonly openNext: () => void;
}
