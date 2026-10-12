import type {
  DiagnosticEvent,
  DiagnosticMetadata,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  decodeClientEnvelope,
  encodeEnvelope,
  isErr,
  sanitizeDiagnosticValue,
} from '@maelstrom-co/protocol';
import type { Engine } from './engine.js';
import { handleEnvelope } from './envelope-handler.js';
import type { Instrument } from './planner/instrument.js';

/** Optional Engine observer. Content remains lazy until explicitly requested. */
export type EngineDiagnosticObserver = (
  event: DiagnosticEvent,
  readContent?: () => unknown,
) => void;

export class EngineDiagnosticEmitter {
  private readonly listeners = new Set<EngineDiagnosticObserver>();
  private readonly requests = new Map<
    SessionId,
    Map<MessageId, { active: number; ambiguous: boolean }>
  >();
  trackRequest(sessionId: SessionId, requestId: MessageId): () => void {
    if (process.env.NODE_ENV === 'production') return () => {};
    let session = this.requests.get(sessionId);
    if (!session) {
      session = new Map();
      this.requests.set(sessionId, session);
    }
    let request = session.get(requestId);
    if (!request) {
      request = { active: 0, ambiguous: false };
      session.set(requestId, request);
    }
    request.active++;
    if (request.active > 1) request.ambiguous = true;
    return () => {
      this.publish(sessionId, requestId, 'engine.request.finished', {
        suppressed: request.ambiguous,
      });
      if (--request.active === 0) {
        session.delete(requestId);
        if (session.size === 0) this.requests.delete(sessionId);
      }
    };
  }
  subscribe(listener: EngineDiagnosticObserver): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(
    sessionId: SessionId,
    requestId: MessageId,
    kind: string,
    metadata: DiagnosticMetadata = {},
    readContent?: () => unknown,
  ): void {
    if (this.requests.get(sessionId)?.get(requestId)?.ambiguous) return;
    this.publish(sessionId, requestId, kind, metadata, readContent);
  }
  private publish(
    sessionId: SessionId,
    requestId: MessageId,
    kind: string,
    metadata: DiagnosticMetadata = {},
    readContent?: () => unknown,
  ): void {
    if (!this.listeners.size) return;
    const event: DiagnosticEvent = {
      id: crypto.randomUUID(),
      sessionId,
      requestId,
      kind,
      at: Date.now(),
      metadata,
    };
    for (const listener of this.listeners) {
      try {
        const result: unknown = listener(event, readContent);
        if (
          result !== null &&
          (typeof result === 'object' || typeof result === 'function') &&
          'then' in result
        )
          void Promise.resolve(result).catch(() => {});
      } catch {
        /* Diagnostics cannot fail a planner. */
      }
    }
  }
  instrument(
    base: Instrument,
    sessionId: SessionId,
    requestId: MessageId,
  ): Instrument {
    if (this.listeners.size === 0) return base;
    return {
      event: (name, attributes) => {
        base.event(name, attributes);
        this.emit(sessionId, requestId, `engine.${name}`, attributes);
      },
      stage: (name, stage) => {
        const wrapped = base.stage(name, stage);
        return async (input, ctx) => {
          const start = performance.now();
          this.emit(
            sessionId,
            requestId,
            'engine.stage.started',
            { stage: name },
            () => input,
          );
          try {
            const result = await wrapped(input, ctx);
            this.emit(
              sessionId,
              requestId,
              'engine.stage.completed',
              {
                stage: name,
                durationMs: performance.now() - start,
                outcome: result.ok ? 'succeeded' : 'failed',
              },
              () => result,
            );
            return result;
          } catch (error) {
            this.emit(
              sessionId,
              requestId,
              'engine.stage.failed',
              { stage: name, durationMs: performance.now() - start },
              () => ({
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            throw error;
          }
        };
      },
    };
  }
}

/** Host-owned policy and transport for one diagnostic connection. */
export interface DiagnosticConnectionOptions {
  /** Explicit server opt-in. Defaults to disabled. Production is always disabled. */
  readonly enabled?: boolean;
  /** Authorized application session for this connection. Every subscription must match it. */
  readonly sessionId: SessionId;
  /** Sends a frame through the application's existing connection. */
  readonly send: (frame: string) => void;
  /** Application-specific redaction before transmitting content or metadata. */
  readonly redact?: (value: unknown) => unknown;
}

/** Connection-owned frame handler with bounded, opt-in diagnostic forwarding. */
export interface DiagnosticConnection {
  /** Handles subscription frames or delegates normal Engine frames. */
  handle(raw: unknown): Promise<string | null>;
  /** Releases the Engine subscription when the connection closes. */
  dispose(): void;
}

/** Creates a server-only helper. The host owns authentication and connection lifetime. */
export function createDiagnosticConnection(
  engine: Engine,
  options: DiagnosticConnectionOptions,
): DiagnosticConnection {
  let enabled = false;
  let content = false;
  let release: (() => void) | undefined;
  let disposed = false;
  const requests = new Map<string, symbol>();
  const releaseSubscription = () => {
    enabled = false;
    content = false;
  };
  const dispose = () => {
    disposed = true;
    releaseSubscription();
    try {
      release?.();
    } catch {
      /* Optional observation cannot prevent connection cleanup. */
    }
    release = undefined;
    requests.clear();
  };
  if (options.enabled === true && process.env.NODE_ENV !== 'production') {
    try {
      release = engine.observeDiagnostics?.((event, readContent) => {
        if (event.sessionId !== options.sessionId || !event.requestId) return;
        const owned = requests.has(event.requestId);
        if (event.kind === 'engine.request.finished')
          requests.delete(event.requestId);
        if (!enabled || !owned) return;
        try {
          const value = {
            type: 'engine.diagnostics.event',
            event: {
              ...event,
              ...(content && readContent ? { content: readContent() } : {}),
            },
          };
          const wire = JSON.stringify(
            sanitizeDiagnosticValue(value, {
              redact: options.redact,
              maxCharacters: 262144,
            }),
          );
          if (wire.length <= 262144) options.send(wire);
        } catch {
          /* Redaction/serialization errors never affect Engine work. */
        }
      });
    } catch {
      /* An unavailable observer must not prevent normal Engine dispatch. */
    }
  }
  return {
    dispose,
    async handle(raw) {
      const decoded = decodeClientEnvelope(raw);
      if (
        !isErr(decoded) &&
        decoded.value.type === 'client.diagnostics.subscribe'
      ) {
        releaseSubscription();
        const subscription = decoded.value;
        if (
          disposed ||
          process.env.NODE_ENV === 'production' ||
          options.enabled !== true ||
          subscription.sessionId !== options.sessionId ||
          !subscription.enabled
        )
          return null;
        enabled = true;
        content = subscription.includeContent;
        return null;
      }
      const request = !isErr(decoded) ? decoded.value : undefined;
      const requestId =
        !disposed &&
        process.env.NODE_ENV !== 'production' &&
        options.enabled === true &&
        request?.type === 'chart_request' &&
        request?.sessionId === options.sessionId &&
        requests.size < 128
          ? request.id
          : undefined;
      const ownership = Symbol();
      if (requestId) requests.set(requestId, ownership);
      try {
        const reply = await handleEnvelope(engine, raw);
        return reply ? encodeEnvelope(reply) : null;
      } finally {
        if (requestId && requests.get(requestId) === ownership)
          requests.delete(requestId);
      }
    },
  };
}
