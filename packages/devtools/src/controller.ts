import type { Orchestrator } from '@maelstrom-co/client';
import {
  type DiagnosticEvent,
  DiagnosticEventSchema,
  sanitizeDiagnosticValue,
} from '@maelstrom-co/protocol';
import { z } from 'zod';
import { DiagnosticCapture } from './capture.js';
import {
  assertCaptureImportSize,
  projectCaptureEvents,
} from './capture-import.js';
import { createDevtools as createDisabledDevtools } from './disabled.js';
import { layoutSnapshot } from './layout-snapshot.js';
import { retainRequestEvents } from './request-history.js';
import type { Devtools, DevtoolsOptions, DevtoolsSnapshot } from './types.js';

const captureOwners = new WeakMap<Orchestrator, Set<string>>();

function setCapturePermission(
  orchestrator: Orchestrator,
  ownerId: string,
  enabled: boolean,
): void {
  const owners = captureOwners.get(orchestrator) ?? new Set<string>();
  if (enabled) owners.add(ownerId);
  else owners.delete(ownerId);
  if (owners.size > 0) captureOwners.set(orchestrator, owners);
  else captureOwners.delete(orchestrator);
  orchestrator.diagnostics.emit('devtools.capture.changed', {
    enabled: owners.size > 0,
  });
}

const captureSchema = (maxEvents: number) =>
  z.object({
    schemaVersion: z.literal(2),
    capture: z
      .object({
        schemaVersion: z.literal(1),
        events: z.array(z.record(z.string(), z.unknown())).max(maxEvents),
      })
      .passthrough(),
  });

class Controller implements Devtools {
  readonly capture: DiagnosticCapture;
  private snapshot: DevtoolsSnapshot = {
    sessions: [],
    activity: [],
    droppedActivityEvents: 0,
    requestActivity: [],
    droppedRequestEvents: 0,
    transportHistory: [],
    imported: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly attached = new Map<
    string,
    { orchestrator: Orchestrator; release: () => void }
  >();
  private selectedCapture: string | undefined;
  private disposed = false;
  private readonly releaseCapture: () => void;
  private readonly releaseRedaction: () => void;
  private readonly inspectors = new Map<string, () => unknown>();
  private overlays = false;
  private highlighted: { clientId: string; instanceId: string } | undefined;

  constructor(readonly options: DevtoolsOptions) {
    this.capture =
      options.capture instanceof DiagnosticCapture
        ? options.capture
        : new DiagnosticCapture(() => null, options.capture);
    this.releaseRedaction = options.redact
      ? this.capture.addRedactor(options.redact)
      : () => {};

    let previousActive = false;
    this.releaseCapture = this.capture.subscribe(() => {
      const active = this.capture.getSnapshot().active;
      if (active !== previousActive) {
        previousActive = active;
        for (const [id, { orchestrator }] of this.attached)
          setCapturePermission(
            orchestrator,
            id,
            this.capture.getSnapshot().active &&
              (!this.selectedCapture || id === this.selectedCapture),
          );
      }
      this.notify();
    });
  }
  getSnapshot = (): DevtoolsSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private clean(value: unknown): unknown {
    return sanitizeDiagnosticValue(value, {
      redact: this.options.redact,
      maxCharacters: this.captureLimit('maxCharacters', 2_000_000),
      maxStringCharacters: this.captureLimit('maxStringCharacters', 16384),
    });
  }

  private captureLimit(
    key: 'maxStringCharacters' | 'maxCharacters',
    fallback: number,
  ): number {
    return this.capture.getLimits()[key] ?? fallback;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* UI observation is optional. */
      }
    }
  }
  private publish(change: Partial<DevtoolsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    this.notify();
  }
  attach(orchestrator: Orchestrator): () => void {
    if (this.disposed || this.options.enabled === false) return () => {};
    const max = this.options.maxSessions ?? 16;
    if (this.attached.size >= max) return () => {};
    const id = crypto.randomUUID();
    const sessionId = orchestrator.getConfig().sessionId;
    const retainedInstances = () =>
      [...orchestrator.commandProcessor.store.state.instances.values()].map(
        ({ instanceId, vesselId, variant }) => ({
          instanceId,
          vesselId,
          variant,
        }),
      );
    const read = () =>
      this.clean({
        config: { sessionId, layoutMode: orchestrator.getConfig().layoutMode },
        connection: orchestrator.connectionManager.store.state.connectionStatus,
        chart: orchestrator.chartManager.store.state.chartDimensions,
        layout: orchestrator.commandProcessor.store.state.layout,
        instances: orchestrator.getStructuralSnapshot(),
        retainedInstances: retainedInstances(),
        vessels: orchestrator.vesselManager.getAll().map((vessel) => ({
          id: vessel.id,
          variants: Object.keys(vessel.variants),
        })),
      });
    let baseline: unknown;
    let retainedSessionId = '[REDACTED]';
    try {
      baseline = read();
      const projected = this.clean({ sessionId });
      if (
        projected !== null &&
        typeof projected === 'object' &&
        'sessionId' in projected &&
        typeof projected.sessionId === 'string'
      )
        retainedSessionId = projected.sessionId;
    } catch {
      return () => {};
    }
    const inspect = () =>
      this.clean({
        snapshot: read(),
        vessels: orchestrator.vesselManager.getAll(),
      });
    this.inspectors.set(id, inspect);
    const update = () => {
      try {
        this.publish({
          sessions: this.snapshot.sessions.map((s) =>
            s.id === id ? { ...s, snapshot: read() } : s,
          ),
        });
      } catch {
        /* A redactor cannot interrupt the client. */
      }
    };
    const record = (event: DiagnosticEvent, content?: () => unknown) => {
      try {
        const checked = DiagnosticEventSchema.safeParse(
          sanitizeDiagnosticValue(
            { ...event, metadata: { ...event.metadata, clientId: id } },
            { redact: this.options.redact, maxCharacters: 262144 },
          ),
        );
        if (!checked.success) return;
        const metadata: DiagnosticEvent = checked.data;
        if (this.options.filter && !this.options.filter(metadata)) return;
        const recording =
          this.capture.getSnapshot().active &&
          (!this.selectedCapture || this.selectedCapture === id);
        if (recording) {
          try {
            let recordedContent: unknown;
            try {
              const layoutEvidence =
                event.requestId &&
                ((event.kind === 'client.command.started' &&
                  event.metadata.command === 'set_layout') ||
                  event.kind === 'client.response.applied' ||
                  event.kind === 'client.response.failed')
                  ? layoutSnapshot(orchestrator)
                  : undefined;
              const evidence = content ? (content() ?? null) : undefined;
              const structural =
                event.kind === 'client.command.completed' ||
                event.kind === 'client.response.applied';
              const captured =
                structural && evidence && typeof evidence === 'object'
                  ? { ...evidence, retainedInstances: retainedInstances() }
                  : evidence;
              recordedContent =
                content || layoutEvidence
                  ? this.clean(
                      layoutEvidence
                        ? {
                            ...(captured && typeof captured === 'object'
                              ? captured
                              : {}),
                            layoutSnapshot: layoutEvidence,
                          }
                        : captured,
                    )
                  : undefined;
            } catch {
              /* Keep metadata when optional content cannot be captured safely. */
            }
            this.capture.record(event.kind, {
              ...metadata,
              content: recordedContent,
            });
          } catch {
            /* Capture storage must not interrupt live metadata publication. */
          }
        }
        const activity = [...this.snapshot.activity, metadata];
        const limit = this.options.maxActivityEvents ?? 100;
        const requests = retainRequestEvents(
          this.snapshot.requestActivity,
          metadata,
          this.options.maxRequestEvents ?? 1000,
        );
        let transportHistory = this.snapshot.transportHistory;
        if (
          event.kind === 'voice.transport' &&
          (event.metadata.state === 'closed' ||
            event.metadata.state === 'error')
        ) {
          transportHistory = [
            ...transportHistory
              .filter(
                (previous) =>
                  previous.metadata.clientId !== id ||
                  previous.metadata.providerInstanceId !==
                    event.metadata.providerInstanceId ||
                  (previous.metadata.providerGeneration ??
                    previous.metadata.generation) !==
                    (event.metadata.providerGeneration ??
                      event.metadata.generation),
              )
              .slice(-15),
            metadata,
          ];
        }
        this.publish({
          activity: activity.slice(-limit),
          requestActivity: requests.events,
          droppedRequestEvents:
            this.snapshot.droppedRequestEvents + requests.dropped,
          transportHistory,
          droppedActivityEvents:
            this.snapshot.droppedActivityEvents +
            Math.max(0, activity.length - limit),
        });
      } catch {
        /* Evidence failure must not change client work. */
      }
    };
    const releaseChannel = orchestrator.diagnostics.subscribe(
      ({ event, readContent }) => record(event, readContent),
    );
    const stores = [
      orchestrator.connectionManager.store,
      orchestrator.commandProcessor.store,
      orchestrator.chartManager.store,
      orchestrator.vesselManager.store,
    ];
    const releases = stores.map((store) => store.subscribe(update));
    let detached = false;
    const release = () => {
      if (detached) return;
      detached = true;
      this.attached.delete(id);
      if (this.highlighted?.clientId === id) {
        this.highlighted = undefined;
        orchestrator.diagnostics.emit('devtools.instance.changed', {
          enabled: false,
        });
      }
      this.inspectors.delete(id);
      orchestrator.diagnostics.emit('devtools.overlays.changed', {
        enabled: false,
      });
      setCapturePermission(orchestrator, id, false);
      releaseChannel();
      for (const subscription of releases) subscription.unsubscribe();
      orchestrator.diagnostics.emit('devtools.overlays.changed', {
        enabled: false,
      });
      this.attached.delete(id);
      if (this.selectedCapture === id) this.stopCapture();
      this.publish({
        sessions: this.snapshot.sessions.map((s) =>
          s.id === id ? { ...s, active: false } : s,
        ),
      });
    };
    this.attached.set(id, { orchestrator, release });
    const retained = [
      ...this.snapshot.sessions,
      { id, sessionId: retainedSessionId, active: true, snapshot: baseline },
    ];
    while (retained.length > max) {
      const stale = retained.findIndex((session) => !session.active);
      if (stale < 0) break;
      retained.splice(stale, 1);
    }
    this.publish({ sessions: retained });

    record(
      {
        id: crypto.randomUUID(),
        kind: 'client.attached',
        sessionId,
        at: Date.now(),
        metadata: {},
      },
      inspect,
    );
    orchestrator.diagnostics.emit('devtools.overlays.changed', {
      enabled: this.overlays,
    });
    setCapturePermission(
      orchestrator,
      id,
      this.capture.getSnapshot().active &&
        (!this.selectedCapture || this.selectedCapture === id),
    );
    return release;
  }
  startCapture(clientId?: string): void {
    if (this.options.enabled === false || this.disposed) return;
    const session = clientId
      ? this.snapshot.sessions.find(
          (session) => session.id === clientId && session.active,
        )
      : undefined;
    if (clientId && !session)
      throw new Error('Select an active Provider before starting a capture.');
    this.selectedCapture = clientId;
    this.capture.start('maelstrom', session?.sessionId, session?.id);

    for (const [id, { orchestrator }] of this.attached)
      if (!clientId || clientId === id)
        orchestrator.diagnostics.emit('client.snapshot', {}, () =>
          this.inspect(id),
        );
  }
  stopCapture(): void {
    this.capture.stop();
    this.selectedCapture = undefined;
  }
  exportCapture(): string {
    return JSON.stringify({
      schemaVersion: 2,
      capture: JSON.parse(this.capture.export()),
    });
  }
  inspect(clientId: string): unknown {
    try {
      return (
        this.inspectors.get(clientId)?.() ??
        this.snapshot.sessions.find((session) => session.id === clientId)
          ?.snapshot ??
        null
      );
    } catch {
      return { unavailable: 'Application redaction failed' };
    }
  }
  clear(): void {
    this.stopCapture();
    this.capture.clear();
    this.publish({
      sessions: this.snapshot.sessions.filter((session) => session.active),
      activity: [],
      droppedActivityEvents: 0,
      requestActivity: [],
      droppedRequestEvents: 0,
      transportHistory: [],
      imported: null,
    });
  }

  importCapture(json: string): void {
    assertCaptureImportSize(
      json,
      this.captureLimit('maxCharacters', 2_000_000),
    );
    const parsed: unknown = JSON.parse(json);
    const normalized =
      typeof parsed === 'object' &&
      parsed !== null &&
      'schemaVersion' in parsed &&
      parsed.schemaVersion === 1
        ? { schemaVersion: 2, capture: parsed }
        : parsed;
    const result = captureSchema(
      Math.max(10000, this.capture.getLimits().maxEvents),
    ).safeParse(normalized);
    if (!result.success)
      throw new Error('Unsupported or invalid Maelstrom capture.');
    projectCaptureEvents(
      result.data.capture.events,
      this.captureLimit('maxCharacters', 2_000_000),
    );
    // Capture fields can be application-defined; live ingress validates diagnostic envelopes.
    const envelope = this.clean({
      ...result.data,
      capture: { ...result.data.capture, events: [] },
    }) as typeof result.data;
    envelope.capture.events = projectCaptureEvents(
      result.data.capture.events,
      this.captureLimit('maxCharacters', 2_000_000),
      (event) => this.clean(event) as Record<string, unknown>,
    );
    this.publish({ imported: envelope });
  }
  closeImport(): void {
    this.publish({ imported: null });
  }
  setOverlays(enabled: boolean): void {
    this.overlays = enabled;
    for (const { orchestrator } of this.attached.values())
      orchestrator.diagnostics.emit('devtools.overlays.changed', { enabled });
  }
  setHighlightedInstance(clientId?: string, instanceId?: string): void {
    const next =
      clientId && instanceId && this.attached.has(clientId)
        ? { clientId, instanceId }
        : undefined;
    if (
      this.highlighted?.clientId === next?.clientId &&
      this.highlighted?.instanceId === next?.instanceId
    )
      return;
    const previous = this.highlighted;
    this.highlighted = next;
    if (previous)
      this.attached
        .get(previous.clientId)
        ?.orchestrator.diagnostics.emit('devtools.instance.changed', {
          enabled: false,
        });
    if (this.highlighted !== next) return;
    if (next)
      this.attached
        .get(next.clientId)
        ?.orchestrator.diagnostics.emit('devtools.instance.changed', {
          enabled: true,
          instanceId: next.instanceId,
        });
  }
  dispose(): void {
    this.stopCapture();
    for (const { release } of [...this.attached.values()]) release();
    this.capture.clear();
    this.releaseCapture();
    this.releaseRedaction();
    this.inspectors.clear();
    this.listeners.clear();
    this.disposed = true;
  }
}

/** Creates an isolated development collector. No DOM or connections are created. */
export function createDevtools(options: DevtoolsOptions = {}): Devtools {
  if (process.env.NODE_ENV === 'production' || options.enabled === false)
    return createDisabledDevtools(options);
  return createDevtoolsCollector(options);
}

/** Creates a collector after the entrypoint applies its environment policy. */
export function createDevtoolsCollector(options: DevtoolsOptions): Devtools {
  if (options.enabled === false) return createDisabledDevtools(options);
  for (const [name, value] of Object.entries({
    maxActivityEvents: options.maxActivityEvents ?? 100,
    maxRequestEvents: options.maxRequestEvents ?? 1000,
    maxSessions: options.maxSessions ?? 16,
  }))
    if (!Number.isInteger(value) || value < 1)
      throw new Error(`${name} must be a positive integer.`);
  return new Controller({
    ...options,
    enabled: true,
  });
}
