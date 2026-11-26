import type { DiagnosticChannel, Unsubscribe } from '@maelstrom-co/client';
import type { DiagnosticMetadata } from '@maelstrom-co/protocol';
import type {
  Telemetry,
  TelemetryAttachment,
  TelemetryProvider,
} from '@maelstrom-co/telemetry';
import {
  attachTelemetrySource,
  operationalKinds,
} from '@maelstrom-co/telemetry/integration';

import type { RealtimeProviderAdapter } from './realtime-session/provider-adapter.types.js';
import type { RealtimeSession } from './realtime-session/realtime-session.js';
import {
  DEFAULT_DRAIN_TIMEOUT_MS,
  DEFAULT_PENDING_TOOLS,
  observeTools,
} from './tool-observations.js';

/** Inputs shared by every framework's realtime diagnostic attachment. */
export interface RealtimeDiagnosticAttachment {
  /** Existing session; attachment never connects it or acquires media. */
  readonly session: RealtimeSession;
  /** Existing adapter supplying optional provider diagnostics and transport facts. */
  readonly adapter: RealtimeProviderAdapter;
  /** Owning client observation seam; no DevTools or framework dependency is needed. */
  readonly sink: Pick<DiagnosticChannel, 'observed' | 'addSource'> & {
    /** Legacy diagnostic delivery accepts projected or imported evidence. */
    emit(
      kind: string,
      metadata?: DiagnosticMetadata,
      readContent?: () => unknown,
      requestId?: string,
    ): void;
  } & Partial<
      Pick<
        DiagnosticChannel,
        'diagnosticsObserved' | 'addDiagnosticSource' | 'emitDiagnostic'
      >
    >;
  /** Immutable identity for this provider lifetime. */
  readonly identity: {
    /** Application-owned provider label. */
    readonly provider: string;
    /** Unique identity of this built session, independent of application session identity. */
    readonly providerInstanceId: string;
  };
  /** Time source for speech spans and stall detection. Defaults to the global timers and `Date.now`. */
  readonly clock?: RealtimeDiagnosticClock;
}

/** Replaceable time source for realtime diagnostics, so time-based evidence can be tested deterministically. */
export interface RealtimeDiagnosticClock {
  /** Returns the current time in milliseconds. */
  now(): number;
  /** Schedules `callback` after `delayMs` milliseconds and returns a handle for {@link RealtimeDiagnosticClock.clearTimeout}. */
  setTimeout(callback: () => void, delayMs: number): unknown;
  /** Cancels a callback scheduled by {@link RealtimeDiagnosticClock.setTimeout}. */
  clearTimeout(handle: unknown): void;
}

/** Explicit operational observation of one existing voice session. */
export interface RealtimeTelemetryAttachment {
  /** Existing session; attachment never connects it or acquires media. */
  readonly session: Pick<RealtimeSession, 'events'>;
  /** Application-owned delivery lifetime. Omission or disabled telemetry does not subscribe. */
  readonly telemetry?: Telemetry;
  /** Fixed application-selected category captured for this lifetime; omission preserves unknown provider. */
  readonly providerCategory?: TelemetryProvider;
  /** Maximum accepted pending tool observations, from 1 to 65,536. Defaults to 1,000; excess calls report source loss. */
  readonly maxPendingTools?: number;
  /** Maximum retirement drain time, from 1 to 60,000 milliseconds. Defaults to 30,000; abandoned observations report source loss. */
  readonly drainTimeoutMs?: number;
}

/**
 * Attaches content-free voice operational facts in every environment.
 * Repeated attachments share a subscription and drain promise until the last release.
 * Release all references, await drained, then flush and dispose application-owned telemetry.
 * Omitted or disabled telemetry ignores limits and creates no subscription.
 * @throws If enabled limits are invalid or an existing attachment uses a different category or policy.
 */
export function attachRealtimeTelemetry({
  session,
  telemetry,
  providerCategory,
  maxPendingTools = DEFAULT_PENDING_TOOLS,
  drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
}: RealtimeTelemetryAttachment): TelemetryAttachment {
  let enabled = false;
  try {
    enabled = telemetry?.enabled === true;
  } catch {
    /* Optional telemetry cannot fail session setup. */
  }
  if (!enabled)
    return attachTelemetrySource(session, undefined, 'voice', () => () => {});
  if (
    !Number.isInteger(maxPendingTools) ||
    maxPendingTools < 1 ||
    maxPendingTools > 65_536
  )
    throw new RangeError('maxPendingTools must be an integer from 1 to 65536');
  if (
    !Number.isInteger(drainTimeoutMs) ||
    drainTimeoutMs < 1 ||
    drainTimeoutMs > 60_000
  )
    throw new RangeError('drainTimeoutMs must be an integer from 1 to 60000');
  return attachTelemetrySource(
    session,
    telemetry,
    'voice',
    (observer) => {
      const tools = observeTools(
        session,
        {
          mode: 'telemetry',
          maxPendingTools,
          drainTimeoutMs,
          reportLoss: () =>
            observer(operationalKinds.voiceTelemetryDropped, {}),
        },
        (_event, metadata, kind) => observer(kind, metadata),
      );
      return () => {
        tools.release();
        return tools.drained;
      };
    },
    providerCategory,
    JSON.stringify([maxPendingTools, drainTimeoutMs]),
  );
}

function releaseAll(releases: readonly Unsubscribe[]): void {
  for (const release of releases) {
    try {
      release();
    } catch {
      /* Independent resources must all release. */
    }
  }
}

/**
 * Attaches lazy, framework-independent voice evidence to an existing client.
 * Retirement stops ordinary observation immediately; accepted tool results may drain.
 * While observed, publishes `voice.stall_suspected` once when a user transcript
 * fragment gets no assistant fragment or tool call within 8 seconds, or a tool
 * call gets no result within 20 seconds.
 */
export function attachRealtimeDiagnostics({
  session,
  adapter,
  sink,
  identity: input,
  clock = systemClock,
}: RealtimeDiagnosticAttachment): Unsubscribe {
  const identity = {
    provider: input.provider,
    providerInstanceId: input.providerInstanceId,
  };
  let retired = false;
  let releaseSource: Unsubscribe = () => {};
  let tools: ReturnType<typeof observeTools> | undefined;
  try {
    tools = observeTools(
      session,
      {
        mode: 'diagnostics',
        observed: () => sink.diagnosticsObserved ?? sink.observed,
      },
      (event, metadata, kind) =>
        (sink.emitDiagnostic ?? sink.emit).call(
          sink,
          kind,
          { ...identity, ...metadata },
          () => event,
          typeof metadata.requestId === 'string'
            ? metadata.requestId
            : undefined,
        ),
    );
    void tools.drained.catch(() => {});
    releaseSource = attachDiagnosticSources(
      session,
      adapter,
      sink,
      identity,
      () => retired,
      clock,
    );
  } catch {
    retired = true;
    releaseAll([releaseSource, () => tools?.cancel()]);
  }
  return () => {
    if (retired) return;
    retired = true;
    releaseAll([releaseSource, () => tools?.release()]);
  };
}

function attachDiagnosticSources(
  session: RealtimeSession,
  adapter: RealtimeProviderAdapter,
  sink: RealtimeDiagnosticAttachment['sink'],
  identity: DiagnosticMetadata,
  isRetired: () => boolean,
  clock: RealtimeDiagnosticClock,
): Unsubscribe {
  const observed = () => sink.diagnosticsObserved ?? sink.observed;
  const publish = (
    kind: string,
    metadata: DiagnosticMetadata,
    readContent?: () => unknown,
  ) => {
    if (observed())
      (sink.emitDiagnostic ?? sink.emit).call(
        sink,
        kind,
        metadata,
        readContent,
      );
  };
  return (sink.addDiagnosticSource ?? sink.addSource).call(sink, () => {
    if (isRetired() || !observed()) return () => {};
    let active = true;
    const isActive = () => active && !isRetired() && observed();
    const releases: Unsubscribe[] = [];
    const initial = session.observations.getSnapshot();
    const fragments = new WeakSet(initial?.fragments ?? []);
    let speechStartedAt: number | undefined;
    const userSpeechSpan = (
      userSpeech: string | undefined,
    ): DiagnosticMetadata => {
      if (userSpeech === 'active') {
        speechStartedAt ??= clock.now();
        return {};
      }
      if (userSpeech === undefined || speechStartedAt === undefined) return {};
      const startedAt = speechStartedAt;
      speechStartedAt = undefined;
      return {
        userSpeechStartedAt: startedAt,
        durationMs: Math.max(0, clock.now() - startedAt),
      };
    };
    const stalls = watchStalls(clock, (metadata) => {
      if (!isActive()) return;
      publish(operationalKinds.voiceStallSuspected, {
        ...identity,
        generationScope: 'session',
        ...metadata,
      });
    });
    const reportTransport = (final = false) => {
      if (!observed()) return;
      if ((!active || isRetired()) && !final) return;
      try {
        const snapshot = adapter.getTransportSnapshot?.();
        if (!snapshot || !observed() || ((!active || isRetired()) && !final))
          return;
        const metadata: Record<
          string,
          string | number | boolean | null | undefined
        > = { ...identity, providerGeneration: snapshot.generation };
        for (const key of [
          'state',
          'usageSeconds',
          'finalUsageSeconds',
          'contextUsageRatio',
          'finalization',
          'playback',
        ] as const) {
          const value = snapshot[key];
          if (
            typeof value === 'string' ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value))
          )
            metadata[key] = value;
        }
        publish('voice.transport', metadata);
      } catch {
        /* Optional transport facts cannot affect session work or cleanup. */
      }
    };
    try {
      releases.push(
        session.events.subscribe((event) => {
          if (!isActive()) return;
          if (event.type === 'tool.called')
            stalls.toolCalled(event.callId, event.name, event.generation);
          else if (
            event.type === 'tool.result' ||
            event.type === 'tool.cancelled'
          )
            stalls.toolSettled(event.callId);
          else if (
            event.type === 'session.started' ||
            event.type === 'session.disconnecting' ||
            event.type === 'session.disconnected' ||
            event.type === 'session.error'
          ) {
            stalls.clear();
            if (event.type !== 'session.started') speechStartedAt = undefined;
          }
          if (
            event.type === 'tool.called' ||
            event.type === 'tool.result' ||
            event.type === 'tool.cancelled' ||
            event.type === 'transcript.fragment'
          )
            return;
          publish(
            `voice.${event.type}`,
            {
              ...identity,
              generation: 'generation' in event ? event.generation : undefined,
              generationScope: 'session',
              ...('callId' in event ? { callId: event.callId } : {}),
              ...(event.type === 'media'
                ? {
                    microphone: event.media.microphone,
                    userSpeech: event.media.userSpeech,
                    incomingAudio: event.media.incomingAudio,
                    ...userSpeechSpan(event.media.userSpeech),
                  }
                : {}),
              ...(event.type === 'processing'
                ? { processing: event.processing }
                : {}),
              ...(event.type === 'transcript.entry'
                ? { role: event.role, final: event.final }
                : {}),
            },
            () => event,
          );
          if (!isActive()) return;
          reportTransport();
        }),
      );
      releases.push(
        session.observations.subscribe(() => {
          if (!isActive()) return;
          const snapshot = session.observations.getSnapshot();
          if (!isActive()) return;
          publish('voice.observations', {
            ...identity,
            generation: snapshot.generation,
            generationScope: 'session',
            connection: snapshot.connection,
            microphone: snapshot.media.microphone,
            ...(snapshot.processing ? { processing: snapshot.processing } : {}),
            planning: snapshot.applicationWork.planning,
            applying: snapshot.applicationWork.applying,
          });
          if (!isActive()) return;
          for (const fragment of snapshot.fragments) {
            if (!isActive()) return;
            if (fragments.has(fragment)) continue;
            fragments.add(fragment);
            if (fragment.role === 'user')
              stalls.userFragment(fragment.id, snapshot.generation);
            else stalls.assistantActivity();
            publish(
              'voice.transcript.fragment',
              {
                ...identity,
                generation: snapshot.generation,
                generationScope: 'session',
                fragmentId: fragment.id,
                role: fragment.role,
                final: fragment.final,
                startMs: fragment.startMs,
                endMs: fragment.endMs,
              },
              () => fragment,
            );
          }
        }),
      );
      if (adapter.diagnostics)
        releases.push(
          adapter.diagnostics.subscribe((observation) => {
            if (!isActive()) return;
            const metadata: Record<
              string,
              string | number | boolean | null | undefined
            > = {};
            for (const [key, value] of Object.entries(observation.metadata)) {
              if (
                ![
                  'provider',
                  'providerInstanceId',
                  'generation',
                  'providerGeneration',
                  'clientId',
                  'responsePhase',
                  'responseOutcome',
                ].includes(key)
              )
                metadata[key] = value;
            }
            publish(
              `voice.provider.${observation.kind}`,
              {
                ...metadata,
                ...(observation.response
                  ? {
                      responseId: observation.response.id,
                      responsePhase: observation.response.phase,
                      responseOutcome:
                        observation.response.phase === 'finished'
                          ? observation.response.outcome
                          : undefined,
                    }
                  : {}),
                providerGeneration: observation.providerGeneration,
                ...identity,
              } satisfies DiagnosticMetadata,
              () => observation.readContent?.(),
            );
          }),
        );
      reportTransport();
    } catch {
      active = false;
      stalls.clear();
      releaseAll(releases);
      return () => {};
    }
    return () => {
      active = false;
      stalls.clear();
      reportTransport(true);
      releaseAll(releases);
    };
  });
}

const RESPONSE_STALL_MS = 8_000;
const TOOL_RESULT_STALL_MS = 20_000;

const systemClock: RealtimeDiagnosticClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function watchStalls(
  clock: RealtimeDiagnosticClock,
  report: (metadata: DiagnosticMetadata) => void,
) {
  let response: PendingStall | undefined;
  // Reused call IDs can overlap, so each ID keeps its pending timers oldest first.
  const tools = new Map<string, PendingStall[]>();
  const stopResponse = () => {
    if (response) clock.clearTimeout(response.handle);
    response = undefined;
  };
  return {
    userFragment(fragmentId: string, generation: number) {
      stopResponse();
      const pending: PendingStall = { handle: undefined };
      response = pending;
      pending.handle = clock.setTimeout(() => {
        if (response !== pending) return;
        response = undefined;
        report({ reason: 'no_assistant_response', generation, fragmentId });
      }, RESPONSE_STALL_MS);
    },
    assistantActivity: stopResponse,
    toolCalled(callId: string, tool: string, generation: number | undefined) {
      stopResponse();
      const pending: PendingStall = { handle: undefined };
      const queue = tools.get(callId) ?? [];
      queue.push(pending);
      tools.set(callId, queue);
      pending.handle = clock.setTimeout(() => {
        const current = tools.get(callId);
        const index = current?.indexOf(pending) ?? -1;
        if (!current || index < 0) return;
        current.splice(index, 1);
        if (current.length === 0) tools.delete(callId);
        report({ reason: 'tool_result_timeout', generation, callId, tool });
      }, TOOL_RESULT_STALL_MS);
    },
    toolSettled(callId: string) {
      const queue = tools.get(callId);
      const pending = queue?.shift();
      if (pending) clock.clearTimeout(pending.handle);
      if (queue?.length === 0) tools.delete(callId);
    },
    clear() {
      stopResponse();
      for (const queue of tools.values())
        for (const pending of queue) clock.clearTimeout(pending.handle);
      tools.clear();
    },
  };
}

interface PendingStall {
  handle: unknown;
}
