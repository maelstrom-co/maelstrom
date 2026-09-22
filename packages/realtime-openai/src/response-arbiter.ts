import { RealtimeVoiceError } from '@maelstrom-co/realtime';

type OutputActivity = 'not-started' | 'active' | 'stopped' | 'cleared';
type CompletedTranscript = 'unseen' | 'useful' | 'empty';
interface Sink {
  send(command: object): void;
  error(error: unknown): void;
  debug(category: string): void;
  /** Trigger-only readiness gate. Undefined defers the existing queue; a nonempty ordered snapshot replaces default input. Must not reenter the arbiter. */
  responseInput?(inputId: string | undefined): readonly string[] | undefined;
}
interface Entry {
  committed: boolean;
  completed: CompletedTranscript;
  queued: boolean;
  sent: boolean;
  interrupted: boolean;
  cancelled: boolean;
  clearPending: boolean;
  clearResponseId?: string;
  standaloneClear: boolean;
}
const entry = (): Entry => ({
  committed: false,
  completed: 'unseen',
  queued: false,
  sent: false,
  interrupted: false,
  cancelled: false,
  clearPending: false,
  standaloneClear: false,
});

/** Package-private, generation-local OpenAI response scheduling and interruption policy. */
export class ResponseArbiter {
  #inFlight: { responseId?: string } | undefined;
  #toolPending = false;
  #toolInputId: string | undefined;
  #fatal = false;
  #blockDepth = 0;
  #drainDeferred = false;
  readonly #queue: string[] = [];
  readonly #settled = new Set<string>();
  readonly #cancelled = new Set<string>();
  readonly #ledger = new Map<string, Entry>();
  #activeResponseId: string | undefined;
  #output: OutputActivity = 'not-started';

  readonly #sink: Sink;

  constructor(sink: Sink) {
    this.#sink = sink;
  }

  close(): void {
    this.#inFlight = undefined;
    this.#toolPending = false;
    this.#toolInputId = undefined;
    this.#fatal = true;
    this.#queue.length = 0;
    this.#settled.clear();
    this.#cancelled.clear();
    this.#ledger.clear();
    this.#activeResponseId = undefined;
    this.#output = 'not-started';
  }
  requestToolFollowUp(inputId?: string): void {
    if (this.#fatal) return;
    this.#toolPending = true;
    this.#toolInputId = inputId;
    this.#drain();
  }
  /** Retry deferred reference readiness without adding, reordering, or discarding requests. Inert after close or fatal dispatch failure. */
  referencesChanged(): void {
    this.#drain();
  }
  committed(itemId: string | undefined): void {
    const e = this.#get(itemId);
    if (!itemId || !e) return;
    e.committed = true;
    this.#eligible(itemId, e);
  }
  completed(itemId: string | undefined, useful: boolean): void {
    const e = this.#get(itemId);
    if (!itemId || !e) return;
    if (e.completed === 'unseen') e.completed = useful ? 'useful' : 'empty';
    this.#eligible(itemId, e);
  }
  usefulDelta(itemId: string | undefined): void {
    if (this.#fatal) return;
    const e = this.#get(itemId);
    if (!e || e.interrupted) return;
    e.interrupted = true;
    if (this.#activeResponseId) this.#cancel(e, this.#activeResponseId);
    else if (this.#output === 'active') this.#standaloneClear(e);
  }
  responseCreated(responseId: string | undefined): void {
    if (this.#fatal) return;
    if (!responseId || this.#settled.has(responseId)) {
      this.#sink.debug('created-unmatched');
      return;
    }
    if (!this.#inFlight && this.#sink.responseInput) {
      this.#sink.debug('created-unsolicited');
      return;
    }
    if (!this.#inFlight) this.#inFlight = { responseId };
    else if (!this.#inFlight.responseId) this.#inFlight = { responseId };
    else {
      if (this.#inFlight.responseId !== responseId)
        this.#sink.debug('created-conflict');
      return;
    }
    this.#activeResponseId = responseId;
    this.#output = 'not-started';
  }
  responseDone(
    responseId: string | undefined,
    cancelledEmptyOutput: boolean,
  ): void {
    if (
      !responseId ||
      !this.#inFlight ||
      this.#settled.has(responseId) ||
      (this.#sink.responseInput && !this.#inFlight.responseId) ||
      (this.#inFlight.responseId && this.#inFlight.responseId !== responseId)
    )
      return;
    const current = this.#inFlight;
    this.#settled.add(responseId);
    this.#cancelled.delete(responseId);
    this.#inFlight = undefined;
    if (cancelledEmptyOutput)
      for (const e of this.#ledger.values())
        if (e.clearResponseId === responseId) {
          e.clearPending = false;
          e.clearResponseId = undefined;
        }
    if (this.#activeResponseId === responseId || !current.responseId)
      this.#activeResponseId = undefined;
    this.#drain();
  }
  outputStarted(): void {
    this.#output = 'active';
    this.#fulfill();
  }
  outputStopped(): void {
    this.#output = 'stopped';
    this.#fulfill();
  }
  outputCleared(): void {
    this.#output = 'cleared';
    this.#fulfill();
  }

  #get(id: string | undefined): Entry | undefined {
    if (!id?.trim()) return;
    let e = this.#ledger.get(id);
    if (!e) {
      e = entry();
      this.#ledger.set(id, e);
    }
    return e;
  }
  #eligible(id: string, e: Entry): void {
    if (!e.committed || e.completed !== 'useful' || e.queued || this.#fatal)
      return;
    e.queued = true;
    this.#queue.push(id);
    this.#drain();
  }
  #create(inputId: string | undefined, consume: () => void): void {
    if (this.#fatal) return;
    try {
      const ids = this.#sink.responseInput?.(inputId);
      if (this.#sink.responseInput && ids === undefined) {
        this.#drainDeferred = true;
        return;
      }
      if (ids && (!ids.length || ids.some((id) => !id.trim()))) {
        throw new RealtimeVoiceError(
          'ACTIVATION_ELIGIBILITY_FAILED',
          'OpenAI response requires nonempty eligible input references',
        );
      }
      const command = {
        type: 'response.create',
        ...(ids
          ? {
              response: {
                conversation: 'auto',
                input: ids.map((id) => ({ type: 'item_reference', id })),
              },
            }
          : {}),
      };
      this.#inFlight = {};
      consume();
      this.#sink.send(command);
    } catch (cause) {
      this.#inFlight = undefined;
      this.#fatal = true;
      this.#sink.error(
        cause instanceof RealtimeVoiceError
          ? cause
          : new RealtimeVoiceError(
              'DATA_CHANNEL_ERROR',
              'Failed to send OpenAI realtime response.create',
              cause,
            ),
      );
    }
  }
  #drain(): void {
    if (this.#fatal || this.#inFlight) return;
    if (this.#blocked()) {
      this.#drainDeferred = true;
      return;
    }
    this.#drainDeferred = false;
    if (this.#toolPending) {
      this.#create(this.#toolInputId, () => {
        this.#toolPending = false;
        this.#toolInputId = undefined;
      });
      return;
    }
    const id = this.#queue[0];
    if (!id) return;
    const e = this.#ledger.get(id);
    if (!e || e.sent) return;
    this.#create(id, () => {
      this.#queue.shift();
      e.sent = true;
    });
  }
  #blocked(): boolean {
    return (
      this.#blockDepth > 0 ||
      [...this.#ledger.values()].some((e) => e.clearPending)
    );
  }
  #resume(): void {
    if (this.#drainDeferred) this.#drain();
  }
  #cancel(e: Entry, id: string): void {
    if (e.cancelled) return;
    e.cancelled = true;
    if (this.#cancelled.has(id)) {
      if (this.#output === 'active') this.#standaloneClear(e);
      return;
    }
    this.#cancelled.add(id);
    this.#sink.debug('interruption-cancel');
    this.#blockDepth++;
    e.clearPending = true;
    e.clearResponseId = id;
    try {
      this.#sink.send({ type: 'response.cancel', response_id: id });
      this.#fulfill();
    } catch (error) {
      this.#cancelled.delete(id);
      e.clearPending = false;
      e.clearResponseId = undefined;
      this.#sink.error(error);
      if (this.#output === 'active') this.#standaloneClear(e);
    } finally {
      this.#blockDepth--;
      this.#resume();
    }
  }
  #standaloneClear(e: Entry): void {
    if (e.standaloneClear) return;
    e.standaloneClear = true;
    this.#clear();
  }
  #clear(): void {
    this.#sink.debug('interruption-clear');
    const before = this.#output;
    this.#output = 'cleared';
    try {
      this.#sink.send({ type: 'output_audio_buffer.clear' });
    } catch (error) {
      if (this.#output === 'cleared') this.#output = before;
      this.#sink.error(error);
    }
  }
  #fulfill(): void {
    this.#blockDepth++;
    try {
      let clear = false;
      for (const e of this.#ledger.values()) {
        if (!e.clearPending) continue;
        if (this.#output === 'stopped' || this.#output === 'cleared') {
          e.clearPending = false;
          e.clearResponseId = undefined;
        } else if (this.#output === 'active') {
          e.clearPending = false;
          e.clearResponseId = undefined;
          clear = true;
        }
      }
      if (clear) this.#clear();
    } finally {
      this.#blockDepth--;
      this.#resume();
    }
  }
}
