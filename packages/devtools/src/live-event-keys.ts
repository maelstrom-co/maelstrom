import { eventIdentity, identity } from './diagnostic-identity.js';

interface EventIdentityState {
  readonly key: string;
  ambiguous: boolean;
}

interface AssignedEventKey {
  readonly key: string;
  readonly readable: boolean;
}

function envelopeIdentity(value: object): string {
  const raw = value as Record<string, unknown>;
  const metadata =
    raw.metadata && typeof raw.metadata === 'object'
      ? (raw.metadata as Record<string, unknown>)
      : {};
  return JSON.stringify([
    identity(raw.kind),
    typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : null,
    identity(raw.sessionId),
    identity(raw.requestId),
    identity(metadata.clientId),
  ]);
}

export class LiveEventKeys {
  private readonly assigned = new WeakMap<object, AssignedEventKey>();
  private readonly identities = new Map<string, EventIdentityState>();

  begin(sources: readonly (readonly unknown[])[]): void {
    // Unmounted panels cannot observe gaps; only retained objects prove continuity.
    this.identities.clear();
    this.update(sources);
  }

  update(sources: readonly (readonly unknown[])[]): void {
    const present = new Set<string>();
    const ambiguous = new Set<string>();
    const retainedKeys = new Map<string, string>();
    const envelopes = new Map<string, string>();
    for (const source of sources) {
      const seen = new Set<string>();
      for (const value of source) {
        const id = eventIdentity(value);
        if (!id) continue;
        if (seen.has(id)) ambiguous.add(id);
        seen.add(id);
        present.add(id);
        const envelope = envelopeIdentity(value as object);
        // Different envelopes disprove identity; matching fields cannot resolve a collision.
        if (envelopes.has(id) && envelopes.get(id) !== envelope)
          ambiguous.add(id);
        envelopes.set(id, envelope);
        const known = this.assigned.get(value as object);
        if (known?.readable) retainedKeys.set(id, known.key);
        else if (known) ambiguous.add(id);
      }
    }
    for (const id of this.identities.keys()) {
      if (!present.has(id)) this.identities.delete(id);
    }
    for (const id of present) {
      const previous = this.identities.get(id);
      if (previous) {
        // A copied duplicate can outlive its partner; cardinality cannot restore identity.
        previous.ambiguous ||= ambiguous.has(id);
      } else {
        this.identities.set(id, {
          key:
            retainedKeys.get(id) ??
            JSON.stringify(['event', id, crypto.randomUUID()]),
          ambiguous: ambiguous.has(id),
        });
      }
    }
  }

  key(value: object): string {
    const known = this.assigned.get(value);
    if (known) return known.key;
    const id = eventIdentity(value);
    const identity = id ? this.identities.get(id) : undefined;
    const key =
      identity && !identity.ambiguous
        ? identity.key
        : JSON.stringify(['local', crypto.randomUUID()]);
    this.assigned.set(value, {
      key,
      readable: Boolean(identity && !identity.ambiguous),
    });
    return key;
  }
}
