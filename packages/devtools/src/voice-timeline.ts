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
  requests: {
    key: string;
    requestId: string;
    available: boolean;
    ambiguous?: boolean;
  }[];
}

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
  readonly isAmbiguous = (key: string): boolean =>
    this.exhausted || this.poisonedLanes.has(key);

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
  knownAmbiguities?: (laneKey: string) => boolean,
): VoiceLane[] {
  const lanes = voiceLanes(evidence.events);
  const availableRequests = new Map<
    string,
    {
      sessions: Set<string>;
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
      supported: false,
      starts: 0,
      ends: 0,
      ambiguous: false,
    };
    const sessionId = identity(event.raw.sessionId);
    if (sessionId) request.sessions.add(sessionId);
    request.supported ||= !event.kind.startsWith('voice.');
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
    const sourceSessions = new Set(
      lane.events.flatMap((event) => {
        const id = identity(event.raw.sessionId);
        return id ? [id] : [];
      }),
    );
    lane.groupingDisabled =
      lane.contextAmbiguous || (knownAmbiguities?.(lane.key) ?? false);
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
      for (const event of group.events) {
        if (!lane.clientId || !event.requestId) continue;
        const key = JSON.stringify([lane.clientId, event.requestId]);
        if (requests.has(key)) continue;
        requests.add(key);
        const target = availableRequests.get(key);
        const ambiguous =
          sourceSessions.size > 1 ||
          Boolean(
            target &&
              (target.ambiguous ||
                target.sessions.size > 1 ||
                (target.sessions.size > 0 &&
                  [...sourceSessions].some(
                    (session) => !target.sessions.has(session),
                  ))),
          );
        group.requests.push({
          key,
          requestId: event.requestId,
          available: Boolean(target?.supported && !ambiguous),
          ...(ambiguous ? { ambiguous: true } : {}),
        });
      }
    }
  }
  return lanes;
}
