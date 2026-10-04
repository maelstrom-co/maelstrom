import type {
  TimedTranscriptFragment,
  VoiceApplicationWorkSource,
  VoiceCaption,
  VoiceConnectionState,
  VoiceMediaObservation,
  VoiceObservationSnapshot,
  VoiceObservationSource,
} from '@maelstrom-co/client';
import type { ContinuousTranscriptOptions } from './realtime-session.types.js';
import type { SessionEventHandler } from './session-event-bus.js';
import {
  DEFAULT_MAX_FRAGMENT_CHARS,
  isValidFragment,
} from './transcript-fragment-validation.js';

const UNKNOWN_MEDIA: VoiceMediaObservation = Object.freeze({
  microphone: 'unknown',
  userSpeech: 'unknown',
  incomingAudio: 'unknown',
});

/**
 * Folds session events into `store` through its existing methods. Tool
 * outcomes and the opening claim are not observations and are ignored.
 */
export function observationStoreSubscriber(
  store: VoiceObservationStore,
): SessionEventHandler {
  return (event) => {
    switch (event.type) {
      case 'session.started':
        store.begin();
        return;
      case 'session.connected':
        store.connection('connected');
        return;
      case 'session.disconnecting':
        store.connection('disconnecting');
        return;
      case 'session.disconnected':
        store.connection('disconnected');
        return;
      case 'session.error':
        store.connection('error');
        return;
      case 'transcript.fragment':
        store.fragment(event.fragment);
        return;
      case 'media':
        store.media(event.media);
        return;
      default:
        return;
    }
  };
}

export class VoiceObservationStore implements VoiceObservationSource {
  readonly #maxFragments: number;
  readonly #maxFragmentChars: number;
  readonly #groupGapMs: number;
  readonly #work: VoiceApplicationWorkSource | undefined;
  readonly #listeners = new Set<() => void>();
  #releaseWork: (() => void) | undefined;
  #nextCaption = 0;
  #nextFragment = 0;
  #fragmentOrder = new Map<string, number>();
  #captionOrder = new Map<string, number>();
  #snapshot: VoiceObservationSnapshot = Object.freeze({
    generation: 0,
    connection: 'disconnected',
    media: UNKNOWN_MEDIA,
    applicationWork: Object.freeze({
      planning: 'unknown',
      applying: 'unknown',
    }),
    fragments: Object.freeze([]),
    captions: Object.freeze([]),
  });

  constructor(
    options: ContinuousTranscriptOptions = {},
    work?: VoiceApplicationWorkSource,
  ) {
    this.#maxFragments = options.maxFragments ?? 256;
    this.#maxFragmentChars =
      options.maxFragmentChars ?? DEFAULT_MAX_FRAGMENT_CHARS;
    this.#groupGapMs = options.groupGapMs ?? 1000;
    for (const value of [this.#maxFragments, this.#maxFragmentChars]) {
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new RangeError(
          'Transcript capacities must be positive safe integers',
        );
    }
    if (!Number.isFinite(this.#groupGapMs) || this.#groupGapMs < 0)
      throw new RangeError(
        'Transcript group gap must be finite and nonnegative',
      );
    this.#work = work;
  }

  getSnapshot = (): VoiceObservationSnapshot => {
    this.#readWork();
    return this.#snapshot;
  };

  subscribe = (handler: () => void): (() => void) => {
    const listener = () => handler();
    this.#listeners.add(listener);
    if (this.#listeners.size === 1 && this.#work) {
      this.#releaseWork = this.#work.subscribe(() => {
        this.#readWork();
        this.#notify();
      });
    }
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#releaseWork?.();
        this.#releaseWork = undefined;
      }
    };
  };

  #readWork(): void {
    const work = this.#work?.getSnapshot();
    const previous = this.#snapshot.applicationWork;
    if (
      !work ||
      (work.planning === previous.planning &&
        work.applying === previous.applying)
    )
      return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      applicationWork: Object.freeze({
        planning: work.planning,
        applying: work.applying,
      }),
    });
  }

  begin(): void {
    this.#captionOrder.clear();
    this.#nextCaption = 0;
    this.#nextFragment = 0;
    this.#fragmentOrder.clear();
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      generation: this.#snapshot.generation + 1,
      connection: 'connecting',
      media: UNKNOWN_MEDIA,
      fragments: Object.freeze([]),
      captions: Object.freeze([]),
    });
    this.#notify();
  }

  connection(connection: VoiceConnectionState): void {
    if (connection === this.#snapshot.connection) return;
    const media =
      connection === 'connected' || connection === 'connecting'
        ? this.#snapshot.media
        : UNKNOWN_MEDIA;
    this.#snapshot = Object.freeze({ ...this.#snapshot, connection, media });
    this.#notify();
  }

  media(update: Partial<VoiceMediaObservation>): void {
    const previous = this.#snapshot.media;
    const media = Object.freeze({
      microphone: update.microphone ?? previous.microphone,
      userSpeech: update.userSpeech ?? previous.userSpeech,
      incomingAudio: update.incomingAudio ?? previous.incomingAudio,
    });
    if (
      media.microphone === previous.microphone &&
      media.userSpeech === previous.userSpeech &&
      media.incomingAudio === previous.incomingAudio
    )
      return;
    this.#snapshot = Object.freeze({ ...this.#snapshot, media });
    this.#notify();
  }

  fragment(fragment: TimedTranscriptFragment): boolean {
    if (!isValidFragment(fragment, this.#maxFragmentChars)) {
      if (
        fragment.text.length <= this.#maxFragmentChars ||
        fragment.final !== true ||
        !isValidFragment(fragment, Number.POSITIVE_INFINITY)
      )
        return false;
      const retained = this.#snapshot.fragments.find(
        (entry) =>
          entry.id === fragment.id &&
          entry.role === fragment.role &&
          entry.speakerId === fragment.speakerId &&
          entry.startMs === fragment.startMs,
      );
      if (!retained || retained.final || fragment.endMs < retained.endMs)
        return false;
      // Reject oversized text while preserving the observed utterance boundary.
      fragment = { ...retained, endMs: fragment.endMs, final: true };
    }
    const fragments = this.#snapshot.fragments.filter(
      (old) => old.id !== fragment.id,
    );
    if (!this.#fragmentOrder.has(fragment.id))
      this.#fragmentOrder.set(fragment.id, ++this.#nextFragment);
    fragments.push(
      Object.freeze({
        id: fragment.id,
        role: fragment.role,
        speakerId: fragment.speakerId,
        text: fragment.text,
        startMs: fragment.startMs,
        endMs: fragment.endMs,
        ...(fragment.final === undefined ? {} : { final: fragment.final }),
      }),
    );
    fragments.sort(
      (a, b) =>
        a.startMs - b.startMs ||
        (this.#fragmentOrder.get(a.id) ?? 0) -
          (this.#fragmentOrder.get(b.id) ?? 0),
    );
    if (fragments.length > this.#maxFragments)
      fragments.splice(0, fragments.length - this.#maxFragments);
    this.#fragmentOrder = new Map(
      fragments.map((entry) => [
        entry.id,
        this.#fragmentOrder.get(entry.id) ?? 0,
      ]),
    );
    const captions = this.#group(fragments);
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      fragments: Object.freeze(fragments),
      captions: Object.freeze(captions),
    });
    this.#notify();
    return true;
  }

  #group(fragments: readonly TimedTranscriptFragment[]): VoiceCaption[] {
    const groups: TimedTranscriptFragment[][] = [];
    const lastBySpeaker = new Map<string, TimedTranscriptFragment[]>();
    for (const fragment of fragments) {
      const key = JSON.stringify([fragment.role, fragment.speakerId]);
      let group = lastBySpeaker.get(key);
      const last = group?.at(-1);
      const end = group ? Math.max(...group.map((entry) => entry.endMs)) : 0;
      if (!group || last?.final || fragment.startMs - end > this.#groupGapMs) {
        group = [];
        groups.push(group);
        lastBySpeaker.set(key, group);
      }
      group.push(fragment);
    }
    const used = new Set<string>();
    const order = new Map<string, number>();
    const captions = groups.map((group): VoiceCaption => {
      const first = group[0];
      const ids = new Set(group.map((fragment) => fragment.id));
      const previous = this.#snapshot.captions
        .filter(
          (caption) =>
            !used.has(caption.id) &&
            caption.role === first.role &&
            caption.speakerId === first.speakerId &&
            caption.fragmentIds.some((id) => ids.has(id)),
        )
        .sort(
          (a, b) =>
            (this.#captionOrder.get(a.id) ?? 0) -
            (this.#captionOrder.get(b.id) ?? 0),
        )[0];
      const rank = previous
        ? (this.#captionOrder.get(previous.id) ?? 0)
        : ++this.#nextCaption;
      const id = previous?.id ?? `caption-${this.#snapshot.generation}-${rank}`;
      used.add(id);
      order.set(id, rank);
      return Object.freeze({
        id,
        role: first.role,
        speakerId: first.speakerId,
        fragmentIds: Object.freeze([...ids]),
        text: group.map((fragment) => fragment.text).join(''),
        startMs: first.startMs,
        endMs: Math.max(...group.map((fragment) => fragment.endMs)),
        final: group.at(-1)?.final === true,
      });
    });
    this.#captionOrder = order;
    return captions;
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener();
      } catch {
        // Observation failures must not block provider teardown or other observers.
      }
    }
  }
}
