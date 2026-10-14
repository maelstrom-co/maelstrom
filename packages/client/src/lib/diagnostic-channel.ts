import type {
  DiagnosticEvent,
  DiagnosticMetadata,
  SessionId,
} from '@maelstrom-co/protocol';
import type {
  ObservationArguments,
  TelemetryMetadataObserver,
} from '@maelstrom-co/telemetry/integration';
import { MetadataObservers } from '@maelstrom-co/telemetry/integration';
import { notifyObserver } from './utils/notify-observer.js';

/** Lazy content stays unevaluated unless an observer explicitly records it. */
export interface DiagnosticObservation {
  /** Metadata-only event. */
  readonly event: DiagnosticEvent;
  /** Returns content only when called by an explicit capture. */
  readonly readContent?: () => unknown;
}

/** Raw producer scalars requiring an allowlist before export; no envelope or content capability is delivered. */
export type DiagnosticMetadataObserver = TelemetryMetadataObserver;

interface SourceActivation {
  stop?: () => void;
}

interface SourceRegistration {
  readonly start: () => () => void;
  readonly diagnosticOnly: boolean;
  activation?: SourceActivation;
}

/** Per-client observation seam shared by optional library integrations. */
export class DiagnosticChannel {
  private readonly listeners = new Set<
    (observation: DiagnosticObservation) => void
  >();
  private readonly sources = new Set<SourceRegistration>();
  private readonly metadataListeners = new MetadataObservers();
  private readonly controls = new Set<(event: DiagnosticEvent) => void>();
  private readonly controlState = new Map<string, DiagnosticEvent>();
  private disposed = false;

  /** Creates an isolated stream for one application session. */
  constructor(private readonly sessionId: SessionId) {}

  /** Whether a full diagnostic consumer is attached. @deprecated Use diagnosticsObserved. */
  get observed(): boolean {
    return this.listeners.size > 0;
  }

  /** Whether local producer work has a metadata or full diagnostic consumer. */
  get locallyObserved(): boolean {
    return this.listeners.size > 0 || this.metadataListeners.size > 0;
  }

  /** Whether a consumer holds full diagnostics, including optional remote and capture sources. */
  get diagnosticsObserved(): boolean {
    return this.observed;
  }

  /** Observes local producer metadata; forwarded and diagnostic-only evidence is excluded. */
  subscribeMetadata(listener: DiagnosticMetadataObserver): () => void {
    if (this.disposed) return () => {};
    const release = this.metadataListeners.subscribe(listener);
    for (const source of [...this.sources]) this.startSource(source);
    return () => {
      release();
      this.releaseInactiveSources();
    };
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
    for (const source of [...this.sources]) this.startSource(source);
    return () => {
      this.listeners.delete(listener);
      this.releaseInactiveSources();
    };
  }

  /** Registers full diagnostic observation work. @deprecated Use addDiagnosticSource. */
  addSource(start: () => () => void): () => void {
    return this.registerSource(start, true);
  }

  /** Registers local metadata producer work, started for metadata or full diagnostic consumers. */
  addLocalSource(start: () => () => void): () => void {
    return this.registerSource(start, false);
  }

  /** Registers remote or content observation work available only to full diagnostic consumers. */
  addDiagnosticSource(start: () => () => void): () => void {
    return this.registerSource(start, true);
  }

  private registerSource(
    start: () => () => void,
    diagnosticOnly: boolean,
  ): () => void {
    if (this.disposed) return () => {};
    const source: SourceRegistration = { start, diagnosticOnly };
    this.sources.add(source);
    this.startSource(source);
    return () => {
      this.sources.delete(source);
      this.stopSource(source, source.activation);
    };
  }

  /** Emits an isolated observation. Observer failures never change application behavior. */
  emit<Kind extends string>(
    kind: Kind,
    ...args: [
      ...ObservationArguments<NoInfer<Kind>>,
      readContent?: () => unknown,
      requestId?: string,
    ]
  ): void;
  emit(
    kind: string,
    metadata: DiagnosticMetadata = {},
    readContent?: () => unknown,
    requestId?: string,
  ): void {
    if (
      this.disposed ||
      (!this.locallyObserved && !kind.startsWith('devtools.'))
    )
      return;
    this.metadataListeners.emit(kind, metadata);
    this.emitDiagnostic(kind, metadata, readContent, requestId);
  }

  /** Emits diagnostic-only evidence without notifying operational metadata observers. */
  emitDiagnostic(
    kind: string,
    metadata: DiagnosticMetadata = {},
    readContent?: () => unknown,
    requestId?: string,
  ): void {
    if (
      this.disposed ||
      (!this.diagnosticsObserved && !kind.startsWith('devtools.'))
    )
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
    this.metadataListeners.clear();
    this.controls.clear();
    this.controlState.clear();
    for (const source of sources) this.stopSource(source, source.activation);
  }

  private sourceObserved(source: SourceRegistration): boolean {
    return source.diagnosticOnly
      ? this.diagnosticsObserved
      : this.locallyObserved;
  }

  private releaseInactiveSources(): void {
    const active = [...this.sources]
      .filter((source) => !this.sourceObserved(source))
      .map((source) => [source, source.activation] as const);
    // Cleanup may reattach observers before every old source has released.
    for (const [source, activation] of active)
      if (source.activation === activation) source.activation = undefined;
    for (const [source, activation] of active)
      this.stopSource(source, activation);
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
      !this.sourceObserved(source) ||
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
        !this.sourceObserved(source) ||
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
