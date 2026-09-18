import { RealtimeVoiceError } from '../realtime-voice-error.js';
import type {
  AdapterVoiceActivation,
  VoiceActivationInput,
  VoiceInputAdmission,
  VoiceInputAncestry,
} from './provider-adapter.types.js';
import type {
  VoiceActivationConfig,
  VoiceActivationHook,
  VoiceActivationState,
} from './realtime-session.types.js';

const noop = (): void => {};

/** Tokenize whole utterances identically for configuration and successful finals; punctuation separates words except internal apostrophes. */
export function normalizeVoiceWords(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replaceAll('’', "'")
      .match(
        /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:'[\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu,
      ) ?? []
  );
}

function validate(config: VoiceActivationConfig): VoiceActivationConfig {
  if (config.mode === 'normal') return Object.freeze({ mode: 'normal' });
  if (
    config.mode !== 'trigger' ||
    typeof config.phrase !== 'string' ||
    [...config.phrase].length > 200 ||
    !normalizeVoiceWords(config.phrase).length ||
    !Number.isInteger(config.inactivityMs ?? 10000) ||
    (config.inactivityMs ?? 10000) < 1000 ||
    (config.inactivityMs ?? 10000) > 600000
  ) {
    throw new RealtimeVoiceError(
      'ACTIVATION_CONFIG_INVALID',
      'Invalid voice activation configuration',
    );
  }
  return Object.freeze({ ...config });
}

interface InputRecord {
  input: VoiceActivationInput;
  processed: boolean;
  finished: boolean;
  admission: VoiceInputAdmission;
  timer?: ReturnType<typeof setTimeout>;
}

/** Internal provider-independent controller. Adapters retain responsibility for raw identity/order reconciliation and response reference readiness. */
export class VoiceActivationController {
  /** Frozen validated policy; replace the controller for stopped-only reconfiguration. */
  readonly config: VoiceActivationConfig;
  #state: VoiceActivationState;
  #generation = 0;
  #connected = false;
  #epoch = 0;
  #nextOrdinal = 1;
  #boundary = -1;
  #frontier = -1;
  readonly #inputs = new Map<string, InputRecord>();
  readonly #ordinals = new Map<number, string>();
  readonly #busy = new Set<object>();
  readonly #activity = new Map<string | symbol, () => void>();
  readonly #listeners = new Set<() => void>();
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #hook:
    | { controller: AbortController; timer: ReturnType<typeof setTimeout> }
    | undefined;

  constructor(
    config: VoiceActivationConfig,
    private readonly changed: (state: VoiceActivationState) => void,
    private readonly failed: (error: RealtimeVoiceError) => void,
    private readonly warn: (category: string) => void,
  ) {
    this.config = validate(config);
    this.#state = config.mode === 'normal' ? 'disabled' : 'waiting';
  }

  /** Retained policy state; connection state remains separate. */
  get state(): VoiceActivationState {
    return this.#state;
  }

  /** Start fresh connection ownership and return callbacks fenced against future disconnects. */
  connect(): AdapterVoiceActivation {
    this.disconnect();
    this.#connected = true;
    const generation = this.#generation;
    const live = (): boolean =>
      this.#connected && generation === this.#generation;
    return {
      version: 1,
      reportInput: (input) => {
        if (live()) this.#report(input);
      },
      admission: (id) =>
        live() ? this.#admission(id) : { status: 'excluded' },
      onChange: (handler) => {
        if (!live()) return noop;
        this.#listeners.add(handler);
        return () => {
          this.#listeners.delete(handler);
        };
      },
      finishInput: (id) => {
        if (!live()) return;
        const record = this.#inputs.get(id);
        if (
          !record ||
          record.input.outcome === 'pending' ||
          this.#admission(id).status !== 'admitted'
        )
          return;
        record.finished = true;
        this.#reconsiderIdle();
      },
      beginActivity: (key, ancestry) =>
        live() ? this.beginActivity(key, ancestry) : noop,
    };
  }

  /** Abort timers/hooks synchronously, discard private input and invalidate every connection-owned completion. */
  disconnect(): void {
    this.#generation++;
    this.#connected = false;
    this.#cancelIdle();
    this.#abortHook();
    for (const record of this.#inputs.values()) clearTimeout(record.timer);
    this.#inputs.clear();
    this.#ordinals.clear();
    this.#busy.clear();
    this.#activity.clear();
    this.#listeners.clear();
    this.#nextOrdinal = 1;
    this.#boundary = -1;
    this.#frontier = -1;
    this.#setState(this.config.mode === 'normal' ? 'disabled' : 'waiting');
  }

  /** Verify input ancestry against the currently open wake gate; normal mode bypasses it. */
  permits(ancestry: VoiceInputAncestry | undefined): boolean {
    if (this.config.mode === 'normal') return true;
    if (!ancestry || ancestry.epoch !== this.#epoch) return false;
    const record = this.#inputs.get(ancestry.inputId);
    return (
      record?.processed === true &&
      record.input.outcome === 'success' &&
      this.#admission(ancestry.inputId).status === 'admitted'
    );
  }

  /** Keyed work is idempotent and stays busy through provider playback/cancellation terminals, not merely response generation. */
  beginActivity(
    key: string | symbol,
    ancestry: VoiceInputAncestry,
  ): () => void {
    if (!this.permits(ancestry) || !this.#connected) return noop;
    const previous = this.#activity.get(key);
    if (previous) return previous;
    const finish = this.#beginBusy();
    this.#activity.set(key, finish);
    return finish;
  }

  /** Optional connection-lived chat work; cannot activate waiting voice and survives wake-epoch changes. */
  beginChatActivity(): () => void {
    if (
      !this.#connected ||
      this.config.mode !== 'trigger' ||
      !this.config.includeChatActivity
    )
      return noop;
    return this.#beginBusy();
  }

  #beginBusy(): () => void {
    const token = {};
    const generation = this.#generation;
    this.#busy.add(token);
    this.#workStarted();
    return () => {
      if (generation !== this.#generation || !this.#busy.delete(token)) return;
      this.#reconsiderIdle();
    };
  }

  #report(input: VoiceActivationInput): void {
    if (this.config.mode !== 'trigger') return;
    let record = this.#inputs.get(input.id);
    if (record?.processed) return;
    if (
      !input.id ||
      (input.reconciliationTimeoutMs !== undefined &&
        (!Number.isInteger(input.reconciliationTimeoutMs) ||
          input.reconciliationTimeoutMs <= 0 ||
          input.reconciliationTimeoutMs > 2147483647)) ||
      (input.ordinal !== undefined &&
        (!Number.isSafeInteger(input.ordinal) || input.ordinal < 1)) ||
      (input.start !== undefined &&
        (!Number.isFinite(input.start) || input.start < 0)) ||
      (input.end !== undefined &&
        (!Number.isFinite(input.end) ||
          input.start === undefined ||
          input.end < input.start))
    ) {
      this.#fail();
      return;
    }
    if (record) {
      const old = record.input;
      if (
        (old.ordinal !== undefined &&
          input.ordinal !== undefined &&
          old.ordinal !== input.ordinal) ||
        (old.start !== undefined &&
          input.start !== undefined &&
          old.start !== input.start) ||
        (old.end !== undefined &&
          input.end !== undefined &&
          old.end !== input.end)
      ) {
        this.#fail();
        return;
      }
      if (old.outcome !== 'pending') {
        input = { ...input, outcome: old.outcome, text: old.text };
      }
      record.input = { ...old, ...input };
    } else {
      record = {
        input: { ...input },
        processed: false,
        finished: false,
        admission: { status: 'pending' },
      };
      this.#inputs.set(input.id, record);
    }
    const source = record.input;
    if (source.ordinal !== undefined) {
      const owner = this.#ordinals.get(source.ordinal);
      if (owner && owner !== input.id) {
        this.#fail();
        return;
      }
      this.#ordinals.set(source.ordinal, input.id);
      if (source.ordinal < this.#nextOrdinal) {
        this.#exclude(record);
        return;
      }
    }
    const pending = [...this.#inputs.values()].filter(
      (entry) => !entry.processed,
    );
    const bytes = pending.reduce(
      (total, entry) =>
        total + new TextEncoder().encode(entry.input.text ?? '').byteLength,
      0,
    );
    if (pending.length > 128 || bytes > 256 * 1024) {
      this.#fail();
      return;
    }
    if (
      source.outcome === 'pending' &&
      source.end === undefined &&
      source.ordinal !== undefined &&
      source.start !== undefined
    ) {
      clearTimeout(record.timer);
      record.timer = undefined;
    }
    if (
      !record.timer &&
      (source.outcome !== 'pending' ||
        source.end !== undefined ||
        source.ordinal === undefined ||
        source.start === undefined)
    ) {
      const generation = this.#generation;
      record.timer = setTimeout(() => {
        if (generation === this.#generation) this.#fail();
      }, source.reconciliationTimeoutMs ?? 10000);
    }
    this.#workStarted();
    this.#reconcile();
    this.#notify();
    this.#reconsiderIdle();
  }

  #reconcile(): void {
    if (this.config.mode !== 'trigger') return;
    for (;;) {
      const id = this.#ordinals.get(this.#nextOrdinal);
      const record = id === undefined ? undefined : this.#inputs.get(id);
      if (!record || record.input.start === undefined) break;
      const input = record.input;
      if (this.#state !== 'waiting') this.#classify(record);
      if (
        input.outcome === 'pending' ||
        (input.outcome === 'success' && input.end === undefined)
      )
        break;
      this.#nextOrdinal++;
      clearTimeout(record.timer);
      if (this.#state === 'waiting') {
        const matches =
          input.outcome === 'success' &&
          input.start !== undefined &&
          input.start >= this.#frontier &&
          normalizeVoiceWords(input.text ?? '').join('\u0000') ===
            normalizeVoiceWords(this.config.phrase).join('\u0000');
        this.#exclude(record);
        if (matches) {
          this.#boundary = input.end as number;
          this.#epoch++;
          const generation = this.#generation;
          this.#setState('activating');
          if (generation !== this.#generation) return;
          this.#runHook(this.config.onActivate, 'trigger', () => {
            this.#setState('active');
            if (generation !== this.#generation) return;
            this.#releaseHeld();
            this.#reconsiderIdle();
          });
        }
      } else if (
        record.admission.status === 'excluded' ||
        input.outcome !== 'success'
      ) {
        this.#exclude(record);
      } else {
        record.processed = true;
        record.input = { ...input, text: undefined };
      }
      this.#frontier = Math.max(this.#frontier, input.end ?? input.start ?? 0);
    }
    if (this.#state !== 'waiting') {
      for (const record of this.#inputs.values()) {
        if (!record.processed) this.#classify(record);
      }
    }
  }

  #classify(record: InputRecord): void {
    const input = record.input;
    if (input.ordinal === undefined || input.start === undefined) return;
    if (
      input.start < this.#boundary ||
      input.outcome === 'empty' ||
      input.outcome === 'error'
    ) {
      record.admission = { status: 'excluded' };
      return;
    }
    record.admission =
      this.#state === 'activating' || input.ordinal > this.#nextOrdinal
        ? { status: 'held' }
        : {
            status: 'admitted',
            ancestry: { inputId: input.id, epoch: this.#epoch },
          };
  }

  #releaseHeld(): void {
    for (const record of this.#inputs.values()) {
      if (record.admission.status === 'held') this.#classify(record);
    }
    this.#notify();
  }

  #exclude(record: InputRecord): void {
    clearTimeout(record.timer);
    record.processed = true;
    record.finished = true;
    record.admission = { status: 'excluded' };
    record.input = { ...record.input, text: undefined };
  }

  #admission(id: string): VoiceInputAdmission {
    if (!this.#connected) return { status: 'excluded' };
    return this.#inputs.get(id)?.admission ?? { status: 'excluded' };
  }

  #hasWork(): boolean {
    return (
      this.#busy.size > 0 ||
      [...this.#inputs.values()].some((record) => !record.finished)
    );
  }

  #workStarted(): void {
    this.#cancelIdle();
    if (this.#state === 'deactivating') {
      const generation = this.#generation;
      this.#abortHook();
      if (generation === this.#generation) this.#setState('active');
    }
  }

  #reconsiderIdle(): void {
    if (
      !this.#connected ||
      this.config.mode !== 'trigger' ||
      this.#state !== 'active' ||
      this.#hasWork() ||
      this.#idleTimer !== undefined
    )
      return;
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      if (
        !this.#connected ||
        this.#hasWork() ||
        this.#state !== 'active' ||
        this.config.mode !== 'trigger'
      )
        return;
      const generation = this.#generation;
      this.#setState('deactivating');
      if (
        generation !== this.#generation ||
        this.#hasWork() ||
        this.state !== 'deactivating'
      )
        return;
      this.#runHook(this.config.onDeactivate, 'inactivity', () => {
        if (this.#hasWork()) return;
        for (const record of this.#inputs.values()) this.#exclude(record);
        this.#setState('waiting');
        this.#notify();
      });
    }, this.config.inactivityMs ?? 10000);
  }

  #runHook(
    hook: VoiceActivationHook | undefined,
    reason: 'trigger' | 'inactivity',
    complete: () => void,
  ): void {
    if (!hook) {
      complete();
      return;
    }
    const controller = new AbortController();
    const generation = this.#generation;
    const finish = (warning?: string): void => {
      if (
        this.#hook?.controller !== controller ||
        generation !== this.#generation
      )
        return;
      clearTimeout(this.#hook.timer);
      this.#hook = undefined;
      if (warning) {
        controller.abort();
        this.warn(warning);
      }
      if (generation !== this.#generation || !this.#connected) return;
      complete();
    };
    const timer = setTimeout(
      () => finish('voice activation hook timed out'),
      2000,
    );
    this.#hook = { controller, timer };
    try {
      void Promise.resolve(hook({ signal: controller.signal, reason })).then(
        () => finish(),
        () => finish('voice activation hook failed'),
      );
    } catch {
      finish('voice activation hook failed');
    }
  }

  #abortHook(): void {
    const hook = this.#hook;
    this.#hook = undefined;
    if (hook) {
      clearTimeout(hook.timer);
      hook.controller.abort();
    }
  }

  #cancelIdle(): void {
    clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
  }

  #setState(state: VoiceActivationState): void {
    if (state === this.#state) return;
    this.#state = state;
    this.changed(state);
  }

  #notify(): void {
    const generation = this.#generation;
    for (const listener of [...this.#listeners]) {
      if (generation !== this.#generation) return;
      try {
        listener();
      } catch {
        this.warn('voice activation admission listener failed');
      }
    }
  }

  #fail(): void {
    this.disconnect();
    this.failed(
      new RealtimeVoiceError(
        'ACTIVATION_ELIGIBILITY_FAILED',
        'Voice input eligibility could not be established safely',
      ),
    );
  }
}
