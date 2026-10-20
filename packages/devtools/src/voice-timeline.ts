import {
  type IdentityAvailability,
  identity,
  identityAvailability,
} from './diagnostic-identity.js';
import type { PanelEvent, PanelEvidence } from './panel-model.js';
import { requestTerminalStatus } from './request-lifecycle.js';

export interface VoiceLane {
  key: string;
  providerKey: string;
  generationKey: string;
  clientId?: string;
  providerInstanceId?: string;
  providerAvailability: IdentityAvailability;
  provider?: string;
  scope: 'session' | 'provider' | 'legacy' | 'unreported';
  generation?: number;
  generationAvailability: IdentityAvailability;
  events: PanelEvent[];
  groups: VoiceGroup[];
  groupingDisabled: boolean;
  contextAmbiguous: boolean;
}

export interface VoiceGroup {
  key: string;
  type: 'invocation' | 'response' | 'unlinked';
  label: string;
  events: PanelEvent[];
  requests: VoiceRequestReference[];
}

type VoiceRequestReference =
  | { state: 'available'; key: string; requestId: string }
  | {
      state: 'unavailable';
      requestId: string;
      reason: 'ambiguous' | 'not-retained' | 'unconfirmed';
    }
  | {
      state: 'identity-unavailable';
      reason: 'redacted' | 'truncated' | 'unreadable';
    };

export type VoiceLaneContext =
  | { state: 'unobserved' }
  | { state: 'observed'; sessionId?: string }
  | { state: 'ambiguous' }
  | { state: 'exhausted' };

function generation(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

interface LifecycleIdentity {
  starts: number;
  ends: number;
  startKey?: string;
  endKey?: string;
  callId?: string;
  requestId?: string;
  tool?: string;
}

function ambiguousInvocations(
  events: readonly PanelEvent[],
  known = new Map<string, LifecycleIdentity>(),
): Set<string> {
  const ambiguous = new Set<string>();
  for (const event of events) {
    if (!event.kind.startsWith('voice.tool.')) continue;
    const id = identity(event.metadata.invocationId);
    if (!id) continue;
    const previous = known.get(id) ?? { starts: 0, ends: 0 };
    if (event.kind === 'voice.tool.called' && previous.startKey !== event.key) {
      if (previous.ends > 0) ambiguous.add(id);
      previous.startKey ??= event.key;
      previous.starts++;
    }
    if (
      (event.kind === 'voice.tool.result' ||
        event.kind === 'voice.tool.cancelled') &&
      previous.endKey !== event.key
    ) {
      previous.endKey ??= event.key;
      previous.ends++;
    }
    const callId = identity(event.metadata.callId);
    const tool = identity(event.metadata.tool);
    if (
      previous.starts > 1 ||
      previous.ends > 1 ||
      (previous.callId && callId && previous.callId !== callId) ||
      (previous.tool && tool && previous.tool !== tool) ||
      (previous.requestId &&
        event.requestId &&
        previous.requestId !== event.requestId)
    )
      ambiguous.add(id);
    previous.callId ??= callId;
    previous.tool ??= tool;
    previous.requestId ??= event.requestId;
    known.set(id, previous);
  }
  return ambiguous;
}

function responsePhase(
  event: PanelEvent,
): 'started' | 'observed' | 'finished' | undefined {
  const phase = event.metadata.responsePhase;
  return phase === 'started' || phase === 'observed' || phase === 'finished'
    ? phase
    : undefined;
}

function ambiguousResponses(
  events: readonly PanelEvent[],
  known = new Map<string, LifecycleIdentity>(),
): Set<string> {
  const ambiguous = new Set<string>();
  for (const event of events) {
    if (!event.kind.startsWith('voice.provider.')) continue;
    const id = identity(event.metadata.responseId);
    const phase = responsePhase(event);
    if (!id || !phase) continue;
    const previous = known.get(id) ?? { starts: 0, ends: 0 };
    if (phase === 'started' && previous.startKey !== event.key) {
      if (previous.ends > 0) ambiguous.add(id);
      previous.startKey ??= event.key;
      previous.starts++;
    }
    if (phase === 'finished' && previous.endKey !== event.key) {
      previous.endKey ??= event.key;
      previous.ends++;
    }
    if (previous.starts > 1 || previous.ends > 1) ambiguous.add(id);
    known.set(id, previous);
  }
  return ambiguous;
}

export class VoiceCorrelationHistory {
  private readonly poisonedLanes = new Set<string>();
  private readonly seen = new WeakSet<object>();
  private readonly lanes = new Map<
    string,
    {
      sessionId?: string;
      provider?: string;
      identities: Map<string, LifecycleIdentity>;
    }
  >();
  private retained = 0;
  private exhausted = false;
  readonly context = (key: string): VoiceLaneContext => {
    if (this.exhausted) return { state: 'exhausted' };
    if (this.poisonedLanes.has(key)) return { state: 'ambiguous' };
    const lane = this.lanes.get(key);
    return lane
      ? { state: 'observed', sessionId: lane.sessionId }
      : { state: 'unobserved' };
  };

  observe(events: PanelEvent[]): void {
    if (this.exhausted) return;
    for (const lane of voiceLanes(events)) {
      if (
        this.poisonedLanes.has(lane.key) ||
        !lane.clientId ||
        !lane.providerInstanceId ||
        lane.generation === undefined ||
        (lane.scope !== 'session' && lane.scope !== 'provider')
      )
        continue;
      let previous = this.lanes.get(lane.key);
      if (!previous) {
        if (this.retained >= 4096) {
          this.exhaust();
          return;
        }
        previous = { identities: new Map() };
        this.lanes.set(lane.key, previous);
        this.retained++;
      }
      if (lane.contextAmbiguous) {
        this.poison(lane.key);
        if (this.exhausted) return;
        continue;
      }
      for (const event of lane.events) {
        if (this.seen.has(event.raw)) continue;
        this.seen.add(event.raw);
        const sessionId = identity(event.raw.sessionId);
        const provider = identity(event.metadata.provider);
        const contextConflict =
          (previous.sessionId &&
            sessionId &&
            previous.sessionId !== sessionId) ||
          (previous.provider && provider && previous.provider !== provider);
        previous.sessionId ??= sessionId;
        previous.provider ??= provider;
        const before = previous.identities.size;
        const collision =
          lane.scope === 'session'
            ? ambiguousInvocations([event], previous.identities).size > 0
            : ambiguousResponses([event], previous.identities).size > 0;
        this.retained += previous.identities.size - before;
        if (this.retained > 4096) {
          this.exhaust();
          return;
        }
        if (contextConflict || collision) {
          this.poison(lane.key);
          if (this.exhausted) return;
          break;
        }
      }
    }
  }

  private poison(key: string): void {
    const previous = this.lanes.get(key);
    if (previous) this.retained -= 1 + previous.identities.size;
    this.lanes.delete(key);
    // Late observations can return after a gap; bounded history must fail closed.
    if (this.poisonedLanes.size >= 64) this.exhaust();
    else this.poisonedLanes.add(key);
  }

  private exhaust(): void {
    this.exhausted = true;
    this.poisonedLanes.clear();
    this.lanes.clear();
    this.retained = 0;
  }
}

function voiceLanes(events: readonly PanelEvent[]): VoiceLane[] {
  const lanes = new Map<string, VoiceLane>();
  const seen = new Set<string>();
  for (const event of events) {
    if (!event.kind.startsWith('voice.') || seen.has(event.key)) continue;
    seen.add(event.key);
    const provider = identity(event.metadata.providerInstanceId);
    const scope: VoiceLane['scope'] =
      event.metadata.providerGeneration !== undefined
        ? 'provider'
        : event.metadata.generationScope === 'session'
          ? 'session'
          : event.metadata.generation !== undefined
            ? 'legacy'
            : 'unreported';
    const generationValue =
      scope === 'provider'
        ? event.metadata.providerGeneration
        : event.metadata.generation;
    const number = generation(generationValue);
    const availability = identityAvailability(generationValue);
    const generationAvailability =
      number !== undefined
        ? 'reported'
        : availability === 'reported'
          ? 'unreadable'
          : availability;
    const providerKey =
      event.clientId && provider
        ? JSON.stringify([event.clientId, provider])
        : JSON.stringify(['unattributed', event.key]);
    const generationKey =
      number === undefined
        ? JSON.stringify([scope, null, generationAvailability])
        : JSON.stringify([scope, number]);
    const key = JSON.stringify([providerKey, generationKey]);
    let lane = lanes.get(key);
    if (!lane) {
      lane = {
        key,
        providerKey,
        generationKey,
        clientId: event.clientId,
        providerInstanceId: provider,
        providerAvailability: identityAvailability(
          event.metadata.providerInstanceId,
        ),
        provider: identity(event.metadata.provider),
        scope,
        generation: number,
        generationAvailability,
        events: [],
        groups: [],
        groupingDisabled: false,
        contextAmbiguous: false,
      };
      lanes.set(key, lane);
    }
    lane.events.push(event);
  }
  for (const lane of lanes.values()) {
    const providers = new Set(
      lane.events.flatMap((event) =>
        identity(event.metadata.provider)
          ? [identity(event.metadata.provider)]
          : [],
      ),
    );
    const sessions = new Set(
      lane.events.flatMap((event) =>
        identity(event.raw.sessionId) ? [identity(event.raw.sessionId)] : [],
      ),
    );
    lane.contextAmbiguous = providers.size > 1 || sessions.size > 1;
    if (providers.size > 1) lane.provider = undefined;
  }
  return [...lanes.values()];
}

export function voiceTimeline(
  evidence: Pick<PanelEvidence, 'events' | 'requestEvents'>,
  laneContext?: (laneKey: string) => VoiceLaneContext,
): VoiceLane[] {
  const lanes = voiceLanes(evidence.events);
  const availableRequests = new Map<
    string,
    {
      sessions: Set<string>;
      supportingSessions: Set<string>;
      supported: boolean;
      starts: number;
      ends: number;
      ambiguous: boolean;
    }
  >();
  const seenRequests = new Set<object>();
  for (const event of evidence.requestEvents ?? evidence.events) {
    if (!event.clientId || !event.requestId || seenRequests.has(event.raw))
      continue;
    seenRequests.add(event.raw);
    const key = JSON.stringify([event.clientId, event.requestId]);
    const request = availableRequests.get(key) ?? {
      sessions: new Set<string>(),
      supportingSessions: new Set<string>(),
      supported: false,
      starts: 0,
      ends: 0,
      ambiguous: false,
    };
    const sessionId = identity(event.raw.sessionId);
    if (sessionId) request.sessions.add(sessionId);
    if (!event.kind.startsWith('voice.')) {
      request.supported = true;
      if (sessionId) request.supportingSessions.add(sessionId);
    }
    if (event.kind === 'client.request.started') {
      request.ambiguous ||= request.starts > 0 || request.ends > 0;
      request.starts++;
    }
    if (requestTerminalStatus(event.kind)) {
      request.ambiguous ||= request.ends > 0;
      request.ends++;
    }
    availableRequests.set(key, request);
  }
  for (const lane of lanes) {
    const context = laneContext?.(lane.key);
    const sourceSessions = new Set(
      lane.events.flatMap((event) => {
        const id = identity(event.raw.sessionId);
        return id ? [id] : [];
      }),
    );
    if (context?.state === 'observed' && context.sessionId)
      sourceSessions.add(context.sessionId);
    const historyUnsafe =
      context?.state === 'ambiguous' || context?.state === 'exhausted';
    lane.groupingDisabled = lane.contextAmbiguous || historyUnsafe;
    const groups = new Map<string, VoiceGroup>();
    const ambiguous = ambiguousInvocations(lane.events);
    const responsesAmbiguous = ambiguousResponses(lane.events);
    let invocations = 0;
    let responses = 0;
    for (const event of lane.events) {
      const scoped =
        lane.clientId &&
        lane.providerInstanceId &&
        lane.generation !== undefined;
      const invocationId =
        scoped &&
        lane.scope === 'session' &&
        event.kind.startsWith('voice.tool.')
          ? identity(event.metadata.invocationId)
          : undefined;
      const responseId =
        scoped &&
        lane.scope === 'provider' &&
        event.kind.startsWith('voice.provider.') &&
        responsePhase(event)
          ? identity(event.metadata.responseId)
          : undefined;
      const usableInvocation =
        invocationId && !ambiguous.has(invocationId) && !lane.groupingDisabled
          ? invocationId
          : undefined;
      const usableResponse =
        responseId &&
        !responsesAmbiguous.has(responseId) &&
        !lane.groupingDisabled
          ? responseId
          : undefined;
      const type = usableInvocation
        ? 'invocation'
        : usableResponse
          ? 'response'
          : 'unlinked';
      const key = JSON.stringify([
        type,
        usableInvocation ?? usableResponse ?? event.key,
      ]);
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          type,
          label:
            type === 'invocation'
              ? `Tool invocation ${++invocations}`
              : type === 'response'
                ? `Provider response ${++responses}`
                : 'Not linked to a turn',
          events: [],
          requests: [],
        };
        groups.set(key, group);
      }
      group.events.push(event);
    }
    lane.groups = [...groups.values()];
    for (const group of lane.groups) {
      const requests = new Set<string>();
      const unavailableIdentities = new Set<IdentityAvailability>();
      for (const event of group.events) {
        const availability = identityAvailability(event.raw.requestId);
        if (availability === 'not-reported') continue;
        if (availability !== 'reported') {
          if (!unavailableIdentities.has(availability)) {
            unavailableIdentities.add(availability);
            group.requests.push({
              state: 'identity-unavailable',
              reason: availability,
            });
          }
          continue;
        }
        if (!event.requestId) continue;
        if (!lane.clientId) {
          group.requests.push({
            state: 'unavailable',
            requestId: event.requestId,
            reason: 'unconfirmed',
          });
          continue;
        }
        const key = JSON.stringify([lane.clientId, event.requestId]);
        if (requests.has(key)) continue;
        requests.add(key);
        const target = availableRequests.get(key);
        const directSession = identity(event.raw.sessionId);
        const ownershipSessions = lane.groupingDisabled
          ? new Set(directSession ? [directSession] : [])
          : sourceSessions;
        const ambiguous =
          ownershipSessions.size > 1 ||
          Boolean(
            target &&
              (target.ambiguous ||
                target.sessions.size > 1 ||
                (target.sessions.size > 0 &&
                  [...ownershipSessions].some(
                    (session) => !target.sessions.has(session),
                  ))),
          );
        const confirmed = lane.groupingDisabled
          ? Boolean(
              directSession && target?.supportingSessions.has(directSession),
            )
          : [...sourceSessions].some((session) =>
              target?.supportingSessions.has(session),
            );
        const reference = { requestId: event.requestId };
        group.requests.push(
          ambiguous
            ? { ...reference, state: 'unavailable', reason: 'ambiguous' }
            : !target?.supported
              ? { ...reference, state: 'unavailable', reason: 'not-retained' }
              : !confirmed
                ? { ...reference, state: 'unavailable', reason: 'unconfirmed' }
                : { ...reference, key, state: 'available' },
        );
      }
    }
  }
  return lanes;
}
