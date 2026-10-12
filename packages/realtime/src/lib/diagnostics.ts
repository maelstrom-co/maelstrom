import type { DiagnosticChannel, Unsubscribe } from '@maelstrom-co/client';
import type { DiagnosticMetadata } from '@maelstrom-co/protocol';
import type { RealtimeProviderAdapter } from './realtime-session/provider-adapter.types.js';
import type { RealtimeSession } from './realtime-session/realtime-session.js';

/** Inputs shared by every framework's realtime diagnostic attachment. */
export interface RealtimeDiagnosticAttachment {
  /** Existing session; attachment never connects it or acquires media. */
  readonly session: RealtimeSession;
  /** Existing adapter supplying optional provider diagnostics and transport facts. */
  readonly adapter: RealtimeProviderAdapter;
  /** Owning client observation seam; no DevTools or framework dependency is needed. */
  readonly sink: Pick<DiagnosticChannel, 'observed' | 'addSource' | 'emit'>;
  /** Immutable identity for this provider lifetime. */
  readonly identity: {
    /** Application-owned provider label. */
    readonly provider: string;
    /** Unique identity of this built session, independent of application session identity. */
    readonly providerInstanceId: string;
  };
}

function releaseAll(releases: readonly Unsubscribe[]): void {
  for (const release of releases) {
    try {
      release();
    } catch {
      /* Independent observation resources must all release. */
    }
  }
}

/**
 * Attaches lazy, framework-independent voice evidence to an existing client.
 * The returned retirement stops ordinary observation immediately. Accepted tool
 * results can still drain with their original identity; it never waits for them.
 */
export function attachRealtimeDiagnostics({
  session,
  adapter,
  sink,
  identity: input,
}: RealtimeDiagnosticAttachment): Unsubscribe {
  const identity = {
    provider: input.provider,
    providerInstanceId: input.providerInstanceId,
  };
  const calls = new Set<string>();
  let retired = false;
  let releaseEvents: Unsubscribe = () => {};
  let releaseSource: Unsubscribe = () => {};
  const finishDrain = () => {
    if (!retired || calls.size !== 0) return;
    const release = releaseEvents;
    releaseEvents = () => {};
    releaseAll([release]);
  };
  try {
    releaseEvents = session.events.subscribe((event) => {
      if (
        event.type !== 'tool.called' &&
        event.type !== 'tool.result' &&
        event.type !== 'tool.cancelled'
      )
        return;
      const ownerGeneration = event.generation;
      const key = JSON.stringify([ownerGeneration, event.callId]);
      if (event.type === 'tool.called') {
        if (retired || !sink.observed) return;
        calls.add(key);
        if (calls.size > 1000) {
          const first = calls.values().next().value;
          if (first !== undefined) calls.delete(first);
        }
      } else {
        const owned = calls.delete(key);
        if (retired && !owned) return;
        finishDrain();
        if (!sink.observed) return;
      }
      sink.emit(
        `voice.${event.type}`,
        {
          ...identity,
          generation: ownerGeneration,
          generationScope: 'session',
          callId: event.callId,
          ...(event.type === 'tool.called'
            ? { tool: event.name }
            : event.type === 'tool.result'
              ? { ok: event.ok, durationMs: event.latencyMs }
              : { outcome: 'cancelled' }),
        },
        () => event,
      );
    });
    releaseSource = sink.addSource(() => {
      let active = true;
      const releases: Unsubscribe[] = [];
      const initial = session.observations.getSnapshot();
      const fragments = new WeakSet(initial.fragments);
      const reportTransport = (final = false) => {
        if ((!active || retired) && !final) return;
        try {
          const snapshot = adapter.getTransportSnapshot?.();
          if (!snapshot || ((!active || retired) && !final)) return;
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
          sink.emit('voice.transport', metadata);
        } catch {
          /* Optional transport facts cannot affect session work or cleanup. */
        }
      };
      try {
        releases.push(
          session.events.subscribe((event) => {
            if (!active || retired) return;
            if (
              event.type === 'tool.called' ||
              event.type === 'tool.result' ||
              event.type === 'tool.cancelled' ||
              event.type === 'transcript.fragment'
            )
              return;
            sink.emit(
              `voice.${event.type}`,
              {
                ...identity,
                generation:
                  'generation' in event ? event.generation : undefined,
                generationScope: 'session',
                ...('callId' in event ? { callId: event.callId } : {}),
              },
              () => event,
            );
            if (!active || retired) return;
            reportTransport();
          }),
        );
        releases.push(
          session.observations.subscribe(() => {
            if (!active || retired) return;
            const snapshot = session.observations.getSnapshot();
            if (!active || retired) return;
            sink.emit('voice.observations', {
              ...identity,
              generation: snapshot.generation,
              generationScope: 'session',
              connection: snapshot.connection,
              microphone: snapshot.media.microphone,
              planning: snapshot.applicationWork.planning,
              applying: snapshot.applicationWork.applying,
            });
            if (!active || retired) return;
            for (const fragment of snapshot.fragments) {
              if (!active || retired) return;
              if (fragments.has(fragment)) continue;
              fragments.add(fragment);
              sink.emit(
                'voice.transcript.fragment',
                {
                  ...identity,
                  generation: snapshot.generation,
                  generationScope: 'session',
                },
                () => fragment,
              );
            }
          }),
        );
        if (adapter.diagnostics)
          releases.push(
            adapter.diagnostics.subscribe((observation) => {
              if (!active || retired) return;
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
                  ].includes(key)
                )
                  metadata[key] = value;
              }
              sink.emit(
                `voice.provider.${observation.kind}`,
                {
                  ...metadata,
                  providerGeneration: observation.providerGeneration,
                  ...identity,
                } satisfies DiagnosticMetadata,
                observation.readContent,
              );
            }),
          );
        reportTransport();
      } catch {
        active = false;
        releaseAll(releases);
        return () => {};
      }
      return () => {
        active = false;
        reportTransport(true);
        releaseAll(releases);
      };
    });
  } catch {
    retired = true;
    calls.clear();
    releaseAll([releaseSource, releaseEvents]);
  }
  return () => {
    if (retired) return;
    retired = true;
    releaseAll([releaseSource]);
    finishDrain();
  };
}
