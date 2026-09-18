import {
  type AdapterVoiceActivation,
  RealtimeVoiceError,
  type VoiceActivationInput,
  type VoiceInputAncestry,
} from '@maelstrom-co/realtime';
import { asString, isRecord } from './parse-openai-event.js';

interface Node {
  previous?: string | null;
  created: boolean;
  nonAudio?: boolean;
  source?: Source;
}

interface Source {
  id: string;
  start?: number;
  end?: number;
  ordinal?: number;
  committed: boolean;
  outcome: VoiceActivationInput['outcome'];
  text?: string;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** A finalized, admitted source whose provider-created audio item is available. Not proof of response/output reference readiness. */
export interface AdmittedOpenAIInput {
  /** Connection-local provider audio item ID. */
  readonly id: string;
  /** Whole successful final; private until the receiving adapter forwards it. */
  readonly text: string;
  /** Reconciled contiguous source order, never transcription arrival order. */
  readonly ordinal: number;
  /** Core-issued proof for application events and response/queue activity. */
  readonly ancestry: VoiceInputAncestry;
}

interface Sink {
  /** Return true only after synchronously acquiring response/queue ownership. False defers without consuming the input. */
  release(input: AdmittedOpenAIInput): boolean;
  error(error: RealtimeVoiceError): void;
}

/** Connection-local source reconciliation. This holds private inputs, not a response scheduler or a provider-history allowlist. */
export class TriggerInputLedger {
  readonly #nodes = new Map<string, Node>();
  readonly #ordinals = new Map<number, string>();
  readonly #unsubscribe: () => void;
  #closed = false;
  #draining = false;

  /** Bind one connection's activation bridge; release must acquire queue/activity ownership before returning true. */
  constructor(
    private readonly activation: AdapterVoiceActivation,
    private readonly sink: Sink,
  ) {
    this.#unsubscribe = activation.onChange(() => this.referencesChanged());
  }

  /** Consume only item/source metadata and whole transcription terminals. Unknown event types are ignored; missing source identities fail closed. */
  observe(event: unknown): void {
    if (this.#closed || !isRecord(event)) return;
    const type = asString(event.type);
    const created = type === 'conversation.item.created';
    const sourceEvent =
      type === 'input_audio_buffer.speech_started' ||
      type === 'input_audio_buffer.speech_stopped' ||
      type === 'input_audio_buffer.committed' ||
      type === 'conversation.item.input_audio_transcription.delta' ||
      type === 'conversation.item.input_audio_transcription.completed' ||
      type === 'conversation.item.input_audio_transcription.failed';
    if (!created && !sourceEvent) return;
    const item = isRecord(event.item) ? event.item : undefined;
    const id = asString(created ? item?.id : event.item_id);
    if (!id?.trim()) {
      this.#fail();
      return;
    }
    const node = this.#node(id);
    if (created) {
      node.created = true;
      node.nonAudio =
        item?.type === 'function_call' ||
        item?.type === 'function_call_output' ||
        (item?.type === 'message' &&
          (item.role === 'system' || item.role === 'assistant'));
      if (
        !node.nonAudio &&
        !(item?.type === 'message' && item.role === 'user')
      ) {
        this.#fail();
        return;
      }
      if (node.nonAudio && node.source) {
        this.#fail();
        return;
      }
    }
    if (created || type === 'input_audio_buffer.committed') {
      const previous = event.previous_item_id;
      if (previous !== undefined) {
        if (
          previous !== null &&
          (typeof previous !== 'string' || !previous.trim())
        ) {
          this.#fail();
          return;
        }
        if (
          previous === id ||
          (node.previous !== undefined && node.previous !== previous)
        ) {
          this.#fail();
          return;
        }
        node.previous = previous;
      }
    }
    if (sourceEvent) {
      if (node.nonAudio) {
        this.#fail();
        return;
      }
      node.source ??= {
        id,
        committed: false,
        outcome: 'pending',
        settled: false,
      };
      const source = node.source;
      if (
        type === 'input_audio_buffer.speech_started' &&
        !this.#coordinate(source, 'start', event.audio_start_ms)
      )
        return;
      if (
        type === 'input_audio_buffer.speech_stopped' &&
        !this.#coordinate(source, 'end', event.audio_end_ms)
      )
        return;
      if (
        source.start !== undefined &&
        source.end !== undefined &&
        source.end < source.start
      ) {
        this.#fail();
        return;
      }
      if (type === 'input_audio_buffer.committed') source.committed = true;
      if (source.outcome === 'pending') {
        if (type === 'conversation.item.input_audio_transcription.completed') {
          const text = asString(event.transcript);
          if (text === undefined) {
            this.#fail();
            return;
          }
          source.outcome = text.trim() ? 'success' : 'empty';
          source.text = source.outcome === 'success' ? text : undefined;
        } else if (
          type === 'conversation.item.input_audio_transcription.failed'
        )
          source.outcome = 'error';
      }
    }
    this.#reconcile();
  }

  /** Retry handoff after admission or provider-reference readiness changes; successful handoffs are exactly once and source ordered. */
  referencesChanged(): void {
    if (this.#closed || this.#draining) return;
    this.#draining = true;
    try {
      const sources = [...this.#nodes.values()]
        .flatMap((node) => (node.source ? [node.source] : []))
        .sort((a, b) => (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity));
      for (const source of sources) {
        if (this.#continuing(source)) {
          clearTimeout(source.timer);
          source.timer = undefined;
        }
      }
      for (const source of sources) {
        if (this.#closed) return;
        if (source.settled) continue;
        const admission = this.activation.admission(source.id);
        if (admission.status === 'excluded') {
          if (
            source.outcome !== 'pending' &&
            source.ordinal !== undefined &&
            source.start !== undefined &&
            (source.outcome !== 'success' || source.end !== undefined)
          )
            this.#settle(source);
          continue;
        }
        if (
          admission.status !== 'admitted' ||
          source.outcome !== 'success' ||
          source.ordinal === undefined ||
          source.start === undefined ||
          source.end === undefined ||
          !source.committed ||
          !this.#nodes.get(source.id)?.created
        )
          break;
        if (
          !this.sink.release({
            id: source.id,
            text: source.text ?? '',
            ordinal: source.ordinal,
            ancestry: admission.ancestry,
          })
        )
          break;
        if (this.#closed) return;
        this.#settle(source);
        this.activation.finishInput(source.id);
      }
    } finally {
      this.#draining = false;
    }
  }

  /** Drop held text, deadlines, and subscriptions; subsequent provider events and readiness callbacks are inert. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe();
    for (const node of this.#nodes.values())
      if (node.source) clearTimeout(node.source.timer);
    this.#nodes.clear();
    this.#ordinals.clear();
  }

  #node(id: string): Node {
    let node = this.#nodes.get(id);
    if (!node) {
      node = { created: false };
      this.#nodes.set(id, node);
    }
    return node;
  }

  #coordinate(source: Source, key: 'start' | 'end', value: unknown): boolean {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      (source[key] !== undefined && source[key] !== value)
    ) {
      this.#fail();
      return false;
    }
    source[key] = value;
    return true;
  }

  #predecessorOrdinal(
    previous: string | null | undefined,
    seen: Set<string>,
  ): number | undefined {
    if (previous === null) return 0;
    if (previous === undefined) return;
    if (seen.has(previous)) {
      this.#fail();
      return;
    }
    seen.add(previous);
    const node = this.#nodes.get(previous);
    if (!node) return;
    if (node.source) {
      if (node.source.ordinal === undefined)
        this.#predecessorOrdinal(node.previous, seen);
      return node.source.ordinal;
    }
    if (!node.created || !node.nonAudio) return;
    return this.#predecessorOrdinal(node.previous, seen);
  }

  #reconcile(): void {
    const sources = [...this.#nodes.values()].flatMap((node) =>
      node.source ? [node.source] : [],
    );
    const pending = sources.filter((source) => !source.settled);
    const bytes = pending.reduce(
      (sum, source) =>
        sum + new TextEncoder().encode(source.text ?? '').byteLength,
      0,
    );
    if (pending.length > 128 || bytes > 256 * 1024) {
      this.#fail();
      return;
    }
    let advanced: boolean;
    do {
      advanced = false;
      for (const source of sources) {
        if (source.ordinal !== undefined || source.start === undefined)
          continue;
        const previous = this.#predecessorOrdinal(
          this.#nodes.get(source.id)?.previous,
          new Set([source.id]),
        );
        if (this.#closed) return;
        if (previous === undefined) continue;
        const ordinal = previous + 1;
        const previousId = this.#ordinals.get(previous);
        const previousStart = previousId
          ? this.#nodes.get(previousId)?.source?.start
          : undefined;
        if (previousStart !== undefined && source.start < previousStart) {
          this.#fail();
          return;
        }
        const owner = this.#ordinals.get(ordinal);
        if (owner && owner !== source.id) {
          this.#fail();
          return;
        }
        source.ordinal = ordinal;
        this.#ordinals.set(ordinal, source.id);
        advanced = true;
      }
    } while (advanced);
    for (const source of pending) {
      if (this.#closed) return;
      const continuing = this.#continuing(source);
      if (continuing) {
        clearTimeout(source.timer);
        source.timer = undefined;
      } else if (!source.timer)
        source.timer = setTimeout(() => this.#fail(), 10000);
      this.activation.reportInput({
        id: source.id,
        ...(source.ordinal !== undefined ? { ordinal: source.ordinal } : {}),
        ...(source.start !== undefined
          ? {
              start: source.start,
              ...(source.end !== undefined ? { end: source.end } : {}),
            }
          : {}),
        outcome: source.outcome,
        ...(source.text !== undefined ? { text: source.text } : {}),
      });
    }
    this.referencesChanged();
  }

  #settle(source: Source): void {
    source.settled = true;
    source.text = undefined;
    clearTimeout(source.timer);
    source.timer = undefined;
  }

  #continuing(source: Source): boolean {
    const status = this.activation.admission(source.id).status;
    return (
      source.start !== undefined &&
      source.end === undefined &&
      source.outcome === 'pending' &&
      (source.ordinal !== undefined ||
        status === 'held' ||
        status === 'admitted')
    );
  }

  #fail(): void {
    if (this.#closed) return;
    this.close();
    this.sink.error(
      new RealtimeVoiceError(
        'ACTIVATION_ELIGIBILITY_FAILED',
        'OpenAI input source eligibility could not be established safely',
      ),
    );
  }
}

interface Reference {
  id: string;
  ready: boolean;
  response?: OwnedResponse;
  callId?: string;
  audio: boolean;
  truncating: boolean;
  truncated?: boolean;
}

interface OwnedResponse {
  ticket: string;
  ancestry: VoiceInputAncestry;
  id?: string;
  done: boolean;
  interrupted: boolean;
  audio: boolean;
  playbackEnded: boolean;
  outputs: Map<number, string>;
  inputIds: readonly string[];
  generationEnd: () => void;
  playbackEnd: () => void;
}

interface OwnedCall {
  itemId: string;
  name: string;
  response: OwnedResponse;
  dispatched: boolean;
  end: () => void;
  result?: Promise<void>;
  outputId?: string;
}

interface Creation {
  item: Record<string, unknown>;
  complete(): void;
  reject?(error: RealtimeVoiceError): void;
}

interface ResponseSink {
  send(command: Record<string, unknown>): void;
  error(error: RealtimeVoiceError): void;
  changed(): void;
  followUp(inputId: string): void;
}

/** Connection-owned explicit history and response correlation. Provider references still require live-provider compatibility verification. */
export class TriggerResponseLedger {
  readonly #inputs = new Map<string, VoiceInputAncestry>();
  readonly #references = new Map<string, Reference>();
  readonly #history: (string | OwnedResponse)[] = [];
  readonly #issued = new Map<string, OwnedResponse>();
  readonly #responses = new Map<string, OwnedResponse>();
  readonly #calls = new Map<string, OwnedCall>();
  readonly #deleted = new Set<string>();
  readonly #creations = new Map<string, Creation>();
  readonly #deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #activities = new Set<() => void>();
  readonly #queued = new Map<string, (() => void)[]>();
  #prepared: { inputId: string; ids: readonly string[] } | undefined;
  #grounding: string | undefined;
  #groundingPending = false;
  #nextGrounding: string | undefined;
  #groundingDelete: string | undefined;
  #closed = false;

  /** Bind one activation generation and the existing adapter/arbiter transport callbacks. */
  constructor(
    private readonly activation: AdapterVoiceActivation,
    private readonly sink: ResponseSink,
  ) {}

  /** Acquire queue ownership before the input ledger finishes a finalized admitted source. Duplicate input IDs do not create more work. */
  admit(input: AdmittedOpenAIInput): void {
    if (this.#closed || this.#inputs.has(input.id)) return;
    this.#inputs.set(input.id, input.ancestry);
    this.#references.set(input.id, {
      id: input.id,
      ready: true,
      audio: false,
      truncating: false,
    });
    this.#history.push(input.id);
    this.#queue(input.id, input.ancestry);
  }

  /** Snapshot all live admitted dialogue, or defer while required acknowledgements/terminal reference state are unresolved. Never returns an empty fallback. */
  input(inputId: string | undefined): readonly string[] | undefined {
    this.#prepared = undefined;
    if (this.#closed) return;
    const ancestry = inputId ? this.#inputs.get(inputId) : undefined;
    if (!inputId || !ancestry || !this.#references.has(inputId)) {
      throw new RealtimeVoiceError(
        'ACTIVATION_ELIGIBILITY_FAILED',
        'OpenAI response has no live admitted source',
      );
    }
    const admission = this.activation.admission(inputId);
    if (
      admission.status !== 'admitted' ||
      admission.ancestry.epoch !== ancestry.epoch
    )
      return;
    if (
      this.#groundingPending ||
      this.#creations.size ||
      [...this.#calls.values()].some(
        (call) => !call.outputId || !this.#references.get(call.outputId)?.ready,
      )
    )
      return;
    const ids: string[] = this.#grounding ? [this.#grounding] : [];
    for (const entry of this.#history) {
      if (typeof entry === 'string') {
        const ref = this.#references.get(entry);
        if (!ref) continue;
        if (!ref.ready) return;
        ids.push(entry);
      } else {
        if (!entry.done) return;
        for (const [, id] of [...entry.outputs].sort(([a], [b]) => a - b)) {
          const ref = this.#references.get(id);
          if (!ref) continue;
          if (!ref.ready) return;
          ids.push(id);
        }
      }
    }
    this.#prepared = { inputId, ids };
    return ids;
  }

  /** Send arbiter commands. Creation adds client correlation metadata; cancellation marks retained audio ineligible until provider truncation confirms it. */
  send(command: Record<string, unknown>): void {
    if (this.#closed) return;
    if (command.type === 'response.create') {
      const prepared = this.#prepared;
      this.#prepared = undefined;
      const response = isRecord(command.response)
        ? command.response
        : undefined;
      const expected = prepared?.ids.map((id) => ({
        type: 'item_reference',
        id,
      }));
      if (
        !prepared ||
        response?.conversation !== 'auto' ||
        JSON.stringify(response.input) !== JSON.stringify(expected)
      ) {
        this.#fail();
        return;
      }
      const ancestry = this.#inputs.get(prepared.inputId);
      if (!ancestry) {
        this.#fail();
        return;
      }
      const ticket = crypto.randomUUID();
      const owned: OwnedResponse = {
        ticket,
        ancestry,
        done: false,
        interrupted: false,
        audio: false,
        playbackEnded: false,
        outputs: new Map(),
        inputIds: [...prepared.ids],
        generationEnd: this.#begin(`generation:${ticket}`, ancestry),
        playbackEnd: this.#begin(`playback:${ticket}`, ancestry),
      };
      this.#issued.set(ticket, owned);
      this.#history.push(owned);
      this.#deadline(`response:${ticket}`);
      for (const finish of this.#queued.get(prepared.inputId) ?? []) finish();
      this.#queued.delete(prepared.inputId);
      this.#send({
        ...command,
        response: { ...response, metadata: { maelstrom_response: ticket } },
      });
      return;
    }
    if (command.type === 'response.cancel') {
      const response = this.#responses.get(asString(command.response_id) ?? '');
      if (!response) {
        this.#fail();
        return;
      }
      this.#interrupt(response);
    } else if (command.type === 'output_audio_buffer.clear') {
      for (const response of this.#responses.values())
        if (!response.playbackEnded) this.#interrupt(response);
    }
    this.#send(command);
  }

  /** Replace the current grounding reference with a uniquely identified, content-validated acknowledged item. Rapid updates retain only the latest pending text. */
  ground(text: string): void {
    if (this.#closed) return;
    this.#nextGrounding = text;
    if (this.#groundingPending) return;
    this.#groundingPending = true;
    if (this.#grounding) this.#deleteGrounding();
    else this.#createGrounding();
  }

  /** Send an owned dispatched call's result and wait for its exact creation acknowledgement before requesting an explicitly sourced follow-up. */
  toolResult(callId: string, output: unknown): Promise<void> {
    const call = this.#calls.get(callId);
    if (this.#closed || !call?.dispatched) {
      const error = this.#error();
      this.#fail();
      return Promise.reject(error);
    }
    if (call.result) return call.result;
    const id = `tool-${crypto.randomUUID()}`;
    call.outputId = id;
    const item = {
      id,
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(output),
    };
    const promise = new Promise<void>((resolve, reject) => {
      this.#creations.set(id, {
        item,
        reject,
        complete: () => {
          this.#references.set(id, {
            id,
            ready: true,
            callId,
            audio: false,
            truncating: false,
          });
          this.#history.push(id);
          this.#queue(call.response.ancestry.inputId, call.response.ancestry);
          call.end();
          this.sink.followUp(call.response.ancestry.inputId);
          resolve();
        },
      });
    });
    call.result = promise;
    this.#deadline(`create:${id}`);
    this.#send({ type: 'conversation.item.create', item });
    return promise;
  }

  /** Whether an authenticated response still owns generation; duplicate created events cannot resurrect settled work. */
  isGenerating(responseId: string | undefined): boolean {
    const response = responseId ? this.#responses.get(responseId) : undefined;
    return response !== undefined && !response.done;
  }

  /** Authenticate assistant item events against both response and output-item ownership. */
  ancestry(event: Record<string, unknown>): VoiceInputAncestry | undefined {
    const response = this.#responses.get(asString(event.response_id) ?? '');
    const ref = this.#references.get(asString(event.item_id) ?? '');
    return response && ref?.response === response
      ? response.ancestry
      : undefined;
  }

  /** Authenticate and deduplicate tool dispatch, acquiring call lifetime before application code runs. */
  toolAncestry(event: Record<string, unknown>): VoiceInputAncestry | undefined {
    const call = this.#calls.get(asString(event.call_id) ?? '');
    if (
      !call ||
      call.dispatched ||
      call.itemId !== event.item_id ||
      call.name !== event.name ||
      call.response.id !== event.response_id
    )
      return;
    call.dispatched = true;
    this.#clearDeadline(`call:${event.call_id}`);
    return call.response.ancestry;
  }

  /** Reconcile provider acknowledgements. True authorizes only the correlated response/output lifecycle event, not arbitrary tools or transcripts. */
  observe(event: Record<string, unknown>): boolean {
    if (this.#closed) return false;
    const type = asString(event.type);
    if (type === 'error') {
      this.#fail();
      return false;
    }
    if (type === 'conversation.item.created') {
      const item = isRecord(event.item) ? event.item : undefined;
      const id = asString(item?.id);
      const creation = id ? this.#creations.get(id) : undefined;
      if (creation && id && item) {
        if (
          Object.entries(creation.item).some(
            ([key, value]) =>
              JSON.stringify(item[key]) !== JSON.stringify(value),
          )
        ) {
          this.#fail();
          return false;
        }
        this.#creations.delete(id);
        this.#clearDeadline(`create:${id}`);
        creation.complete();
        this.sink.changed();
      }
      return false;
    }
    if (type === 'conversation.item.deleted') {
      const id = asString(event.item_id);
      if (!id) {
        this.#fail();
        return false;
      }
      if (id === this.#groundingDelete) {
        this.#clearDeadline(`delete:${id}`);
        this.#grounding = undefined;
        this.#groundingDelete = undefined;
        this.#createGrounding();
      } else if (id === this.#grounding) this.#fail();
      else this.#delete(id);
      this.sink.changed();
      return false;
    }
    if (type === 'conversation.item.truncated') {
      const id = asString(event.item_id);
      const ref = id ? this.#references.get(id) : undefined;
      if (ref) {
        if (
          !ref.audio ||
          typeof event.audio_end_ms !== 'number' ||
          !Number.isFinite(event.audio_end_ms) ||
          event.audio_end_ms < 0 ||
          event.content_index !== 0
        ) {
          this.#fail();
          return false;
        }
        ref.truncating = false;
        ref.truncated = true;
        ref.ready = true;
        this.#clearDeadline(`item:${id}`);
        this.sink.changed();
      }
      return false;
    }
    if (type === 'response.created') {
      const raw = isRecord(event.response) ? event.response : undefined;
      const metadata = isRecord(raw?.metadata) ? raw.metadata : undefined;
      const ticket = asString(metadata?.maelstrom_response);
      const response = ticket ? this.#issued.get(ticket) : undefined;
      const id = asString(raw?.id);
      if (
        !id ||
        !response ||
        (response.id !== undefined && response.id !== id) ||
        (this.#responses.has(id) && this.#responses.get(id) !== response)
      )
        return false;
      response.id = id;
      this.#responses.set(id, response);
      this.#clearDeadline(`response:${response.ticket}`);
      return true;
    }
    const raw = isRecord(event.response) ? event.response : undefined;
    const id = asString(raw?.id) ?? asString(event.response_id);
    const response = id ? this.#responses.get(id) : undefined;
    if (!response) return false;
    if (
      type === 'response.output_item.added' ||
      type === 'response.output_item.done'
    ) {
      this.#output(
        response,
        event.output_index,
        event.item,
        type.endsWith('.done'),
      );
    } else if (type === 'response.done') {
      if (response.done) return false;
      if (raw?.status !== 'completed' && raw?.status !== 'cancelled') {
        this.#fail();
        return false;
      }
      if (!Array.isArray(raw?.output)) {
        this.#fail();
        return false;
      }
      raw.output.forEach((item, index) => {
        this.#output(response, index, item, true);
      });
      if (this.#closed) return false;
      if (raw.output.length !== response.outputs.size) {
        this.#fail();
        return false;
      }
      response.done = true;
      if (this.#groundingPending) this.#deleteGrounding();
      if (!response.audio) response.playbackEnded = true;
      if (!response.audio || response.playbackEnded) response.playbackEnd();
      response.generationEnd();
      this.sink.changed();
    } else if (type === 'output_audio_buffer.started') {
      if (response.done && !response.audio) {
        this.#fail();
        return false;
      }
      response.audio = true;
    } else if (
      type === 'output_audio_buffer.stopped' ||
      type === 'output_audio_buffer.cleared'
    ) {
      response.playbackEnded = true;
      response.playbackEnd();
    } else if (
      type === 'response.output_audio.delta' ||
      type === 'response.output_audio.done'
    ) {
      response.audio = true;
    }
    return !this.#closed;
  }

  /** Release only this connection's activities and deadlines and reject unresolved tool acknowledgements. Late callbacks are inert. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const timer of this.#deadlines.values()) clearTimeout(timer);
    this.#deadlines.clear();
    for (const creation of this.#creations.values())
      creation.reject?.(this.#error());
    this.#creations.clear();
    for (const end of this.#activities) end();
    this.#activities.clear();
    this.#queued.clear();
    this.#references.clear();
    this.#history.length = 0;
    this.#issued.clear();
    this.#responses.clear();
    this.#calls.clear();
    this.#deleted.clear();
    this.#inputs.clear();
    this.#nextGrounding = undefined;
    this.#prepared = undefined;
  }

  #output(
    response: OwnedResponse,
    index: unknown,
    raw: unknown,
    terminal: boolean,
  ): void {
    if (this.#closed) return;
    if (
      !Number.isSafeInteger(index) ||
      (index as number) < 0 ||
      !isRecord(raw) ||
      !asString(raw.id)
    ) {
      this.#fail();
      return;
    }
    const id = raw.id as string;
    if (response.done && response.outputs.get(index as number) !== id) {
      this.#fail();
      return;
    }
    if (
      this.#deleted.has(id) ||
      [...response.outputs].some(
        ([otherIndex, otherId]) => otherId === id && otherIndex !== index,
      )
    ) {
      this.#fail();
      return;
    }
    const existing = this.#references.get(id);
    if (
      (existing && existing.response !== response) ||
      (response.outputs.has(index as number) &&
        response.outputs.get(index as number) !== id)
    ) {
      this.#fail();
      return;
    }
    const audio =
      Array.isArray(raw.content) &&
      raw.content.some((part) => isRecord(part) && part.type === 'audio');
    response.audio ||= audio;
    const ref: Reference = existing ?? {
      id,
      response,
      ready: false,
      audio,
      truncating: response.interrupted && audio,
    };
    ref.audio ||= audio;
    if (response.interrupted && ref.audio && !ref.truncated)
      ref.truncating = true;
    ref.ready =
      (ref.truncated === true ||
        raw.status === 'completed' ||
        (terminal && raw.status === undefined)) &&
      !ref.truncating;
    response.outputs.set(index as number, id);
    this.#references.set(id, ref);
    if (raw.type === 'function_call') {
      const callId = asString(raw.call_id);
      const name = asString(raw.name);
      if (!callId || !name) {
        this.#fail();
        return;
      }
      ref.callId = callId;
      const call = this.#calls.get(callId);
      if (
        call &&
        (call.itemId !== id || call.name !== name || call.response !== response)
      ) {
        this.#fail();
        return;
      }
      if (!call) {
        this.#calls.set(callId, {
          itemId: id,
          name,
          response,
          dispatched: false,
          end: this.#begin(`call:${callId}`, response.ancestry),
        });
        this.#deadline(`call:${callId}`);
      }
    } else if (raw.type !== 'message' || raw.role !== 'assistant') {
      this.#fail();
      return;
    }
    if (terminal && !ref.ready) this.#deadline(`item:${id}`);
    else if (ref.ready) this.#clearDeadline(`item:${id}`);
  }

  #interrupt(response: OwnedResponse): void {
    response.interrupted = true;
    for (const id of response.outputs.values()) {
      const ref = this.#references.get(id);
      if (ref?.audio && !ref.truncated) {
        ref.ready = false;
        ref.truncating = true;
        this.#deadline(`item:${id}`);
      }
    }
  }

  #deleteGrounding(): void {
    const id = this.#grounding;
    if (
      !id ||
      this.#groundingDelete ||
      [...this.#issued.values()].some(
        (response) => !response.done && response.inputIds.includes(id),
      )
    )
      return;
    this.#groundingDelete = id;
    this.#deadline(`delete:${id}`);
    this.#send({ type: 'conversation.item.delete', item_id: id });
  }

  #createGrounding(): void {
    if (this.#closed || this.#nextGrounding === undefined) return;
    const text = this.#nextGrounding;
    this.#nextGrounding = undefined;
    const id = `ground-${crypto.randomUUID()}`;
    const item = {
      id,
      type: 'message',
      role: 'system',
      content: [{ type: 'input_text', text }],
    };
    this.#creations.set(id, {
      item,
      complete: () => {
        this.#grounding = id;
        this.#groundingPending = false;
        if (this.#nextGrounding !== undefined) this.ground(this.#nextGrounding);
      },
    });
    this.#deadline(`create:${id}`);
    this.#send({ type: 'conversation.item.create', item });
  }

  #delete(id: string): void {
    if (this.#creations.has(id)) {
      this.#fail();
      return;
    }
    this.#deleted.add(id);
    if (
      [...this.#responses.values()].some(
        (response) => !response.done && response.inputIds.includes(id),
      )
    ) {
      this.#fail();
      return;
    }
    const ref = this.#references.get(id);
    this.#references.delete(id);
    this.#clearDeadline(`item:${id}`);
    if (ref?.callId) {
      const call = this.#calls.get(ref.callId);
      if (call) {
        if (call.outputId && this.#creations.has(call.outputId)) {
          this.#fail();
          return;
        }
        this.#references.delete(call.itemId);
        if (call.outputId) this.#references.delete(call.outputId);
        call.end();
        this.#clearDeadline(`call:${ref.callId}`);
        this.#calls.delete(ref.callId);
      }
    }
  }

  #queue(inputId: string, ancestry: VoiceInputAncestry): void {
    const queue = this.#queued.get(inputId) ?? [];
    queue.push(this.#begin(`queue:${crypto.randomUUID()}`, ancestry));
    this.#queued.set(inputId, queue);
  }

  #begin(key: string, ancestry: VoiceInputAncestry): () => void {
    const finish = this.activation.beginActivity(key, ancestry);
    const end = () => {
      if (this.#activities.delete(end)) finish();
    };
    this.#activities.add(end);
    return end;
  }

  #deadline(key: string): void {
    if (!this.#deadlines.has(key))
      this.#deadlines.set(
        key,
        setTimeout(() => this.#fail(), 10000),
      );
  }

  #clearDeadline(key: string): void {
    clearTimeout(this.#deadlines.get(key));
    this.#deadlines.delete(key);
  }

  #send(command: Record<string, unknown>): void {
    try {
      this.sink.send(command);
    } catch {
      this.#fail();
    }
  }

  #error(): RealtimeVoiceError {
    return new RealtimeVoiceError(
      'ACTIVATION_ELIGIBILITY_FAILED',
      'OpenAI response eligibility could not be established safely',
    );
  }

  #fail(): void {
    if (this.#closed) return;
    this.close();
    this.sink.error(this.#error());
  }
}
