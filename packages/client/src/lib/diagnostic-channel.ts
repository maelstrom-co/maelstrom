import type {
  DiagnosticEvent,
  DiagnosticMetadata,
  SessionId,
} from '@maelstrom-co/protocol';
import { notifyObserver } from './utils/notify-observer.js';

/** Lazy content stays unevaluated unless an observer explicitly records it. */
export interface DiagnosticObservation {
  /** Metadata-only event. */
  readonly event: DiagnosticEvent;
  /** Returns content only when called by an explicit capture. */
  readonly readContent?: () => unknown;
}

interface SourceActivation {
  stop?: () => void;
}

interface SourceRegistration {
  readonly start: () => () => void;
  activation?: SourceActivation;
}

/** Per-client observation seam shared by optional library integrations. */
export class DiagnosticChannel {
  private readonly listeners = new Set<
    (observation: DiagnosticObservation) => void
  >();
  private readonly sources = new Set<SourceRegistration>();
  private readonly controls = new Set<(event: DiagnosticEvent) => void>();
  private readonly controlState = new Map<string, DiagnosticEvent>();
  private disposed = false;

  /** Creates an isolated stream for one application session. */
  constructor(private readonly sessionId: SessionId) {}

  /** Whether any diagnostic consumer is attached. */
  get observed(): boolean {
    return this.listeners.size > 0;
  }

  /** Replays current controls and observes changes without keeping collection sources alive. */
  observeControls(listener: (event: DiagnosticEvent) => void): () => void {
    if (this.disposed) return () => {};
    this.controls.add(listener);
    for (const event of this.controlState.values())
      notifyObserver(listener, event);
    return () => {
      this.controls.delete(listener);
    };
  }

  /** Observes events; unsubscribe releases optional sources after the last observer. */
  subscribe(
    listener: (observation: DiagnosticObservation) => void,
  ): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    if (this.listeners.size === 1)
      for (const source of [...this.sources]) this.startSource(source);
    return () => {
      this.listeners.delete(listener);
      if (!this.observed) {
        const active = [...this.sources].map(
          (source) => [source, source.activation] as const,
        );
        // Cleanup may reattach observers before every old source has released.
        for (const [source, activation] of active)
          if (source.activation === activation) source.activation = undefined;
        for (const [source, activation] of active)
          this.stopSource(source, activation);
      }
    };
  }

  /** Registers optional observation work, started only while diagnostics are observed. */
  addSource(start: () => () => void): () => void {
    if (this.disposed) return () => {};
    const source: SourceRegistration = { start };
    this.sources.add(source);
    if (this.observed) this.startSource(source);
    return () => {
      this.sources.delete(source);
      this.stopSource(source, source.activation);
    };
  }

  /** Emits an isolated observation. Observer failures never change application behavior. */
  emit(
    kind: string,
    metadata: DiagnosticMetadata = {},
    readContent?: () => unknown,
    requestId?: string,
  ): void {
    if (this.disposed || (!this.observed && !kind.startsWith('devtools.')))
      return;
    const event: DiagnosticEvent = {
      id: crypto.randomUUID(),
      kind,
      at: Date.now(),
      sessionId: this.sessionId,
      requestId,
      metadata,
    };
    if (kind.startsWith('devtools.')) {
      this.controlState.set(kind, event);
      for (const control of this.controls) {
        if (this.controlState.get(kind) !== event) break;
        notifyObserver(control, event);
      }
    }
    for (const listener of this.listeners)
      notifyObserver(listener, { event, readContent });
  }

  /** Releases observers and optional sources. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const sources = [...this.sources];
    this.sources.clear();
    this.listeners.clear();
    this.controls.clear();
    this.controlState.clear();
    for (const source of sources) this.stopSource(source, source.activation);
  }

  private stopSource(
    source: SourceRegistration,
    activation: SourceActivation | undefined,
  ): void {
    if (!activation) return;
    if (source.activation === activation) source.activation = undefined;
    const stop = activation.stop;
    activation.stop = undefined;
    try {
      stop?.();
    } catch {
      /* Release every independent source. */
    }
  }

  private startSource(source: SourceRegistration): void {
    if (
      this.disposed ||
      !this.observed ||
      !this.sources.has(source) ||
      source.activation
    )
      return;
    const activation: SourceActivation = {};
    source.activation = activation;
    try {
      const { start } = source;
      const stop = start();
      if (
        this.disposed ||
        !this.observed ||
        !this.sources.has(source) ||
        source.activation !== activation
      )
        stop();
      else activation.stop = stop;
    } catch {
      if (source.activation === activation) source.activation = undefined;
    }
  }
}
