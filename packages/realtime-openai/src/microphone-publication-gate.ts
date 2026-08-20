/** A package-private lease that temporarily mutes greeting publication. */
export interface MicrophonePublicationLease {
  readonly generation: number;
  release(): void;
}

/**
 * Owns the one current microphone-publication lease. Its small interface keeps
 * track snapshots and replacement/staleness rules out of presentation callers.
 */
export class MicrophonePublicationGate {
  #current: Lease | undefined;
  readonly #currentGeneration: () => number;

  constructor(currentGeneration: () => number = () => 0) {
    this.#currentGeneration = currentGeneration;
  }

  acquire(
    stream: MediaStream | undefined,
    generation: number,
  ): MicrophonePublicationLease {
    if (this.#current) this.release(this.#current, true);
    const tracks = [...new Set(stream?.getAudioTracks() ?? [])].map(
      (track) => ({
        track,
        enabled: track.enabled,
      }),
    );
    for (const { track } of tracks) track.enabled = false;
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
    for (const { track, enabled } of lease.tracks) track.enabled = enabled;
  }
}

class Lease implements MicrophonePublicationLease {
  #released = false;
  constructor(
    readonly owner: MicrophonePublicationGate,
    readonly generation: number,
    readonly tracks: readonly {
      readonly track: MediaStreamTrack;
      readonly enabled: boolean;
    }[],
  ) {}

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.owner.release(this);
  }
}
