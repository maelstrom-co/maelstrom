/** A package-private lease that temporarily mutes greeting publication. */
export interface MicrophonePublicationLease {
  readonly generation: number;
  release(): void;
}

/**
 * Counts publication holds per track. Gates that share one instance agree on a
 * single restore value: the first hold records it, and only the last release
 * applies it, whatever order the overlapping gates release in.
 */
export class MicrophoneTrackHolds {
  readonly #held = new WeakMap<
    MediaStreamTrack,
    { readonly enabled: boolean; count: number }
  >();

  hold(track: MediaStreamTrack): void {
    const held = this.#held.get(track);
    if (held) held.count += 1;
    else this.#held.set(track, { enabled: track.enabled, count: 1 });
    track.enabled = false;
  }

  release(track: MediaStreamTrack): void {
    const held = this.#held.get(track);
    if (!held) return;
    held.count -= 1;
    if (held.count > 0) return;
    this.#held.delete(track);
    track.enabled = held.enabled;
  }
}

/**
 * Owns the one current microphone-publication lease. Its small interface keeps
 * track snapshots and replacement/staleness rules out of presentation callers.
 */
export class MicrophonePublicationGate {
  #current: Lease | undefined;
  readonly #currentGeneration: () => number;
  readonly #holds: MicrophoneTrackHolds;

  constructor(
    currentGeneration: () => number = () => 0,
    holds: MicrophoneTrackHolds = new MicrophoneTrackHolds(),
  ) {
    this.#currentGeneration = currentGeneration;
    this.#holds = holds;
  }

  acquire(
    stream: MediaStream | undefined,
    generation: number,
  ): MicrophonePublicationLease {
    if (this.#current) this.release(this.#current, true);
    const tracks = [...new Set(stream?.getAudioTracks() ?? [])];
    for (const track of tracks) this.#holds.hold(track);
    const lease = new Lease(this, generation, tracks);
    this.#current = lease;
    return lease;
  }

  get active(): boolean {
    return this.#current !== undefined;
  }

  releaseCurrent(): void {
    this.#current?.release();
  }

  /** @internal Called only by the current lease. */
  release(lease: Lease, replacing = false): void {
    if (this.#current !== lease) return;
    // A stale direct release must leave ownership intact: a successor acquire
    // still needs this lease's original snapshot to restore before it mutes.
    if (!replacing && lease.generation !== this.#currentGeneration()) return;
    this.#current = undefined;
    for (const track of lease.tracks) this.#holds.release(track);
  }
}

class Lease implements MicrophonePublicationLease {
  #released = false;
  constructor(
    readonly owner: MicrophonePublicationGate,
    readonly generation: number,
    readonly tracks: readonly MediaStreamTrack[],
  ) {}

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.owner.release(this);
  }
}
