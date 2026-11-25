import {
  createLiveCapture,
  type LiveCapture,
  type LiveCaptureOptions,
} from './live-capture';
import {
  createLiveTranscript,
  type TranscriptPart,
} from './live-transcript.store';
import type { Topic } from './outline.store';
import { createSemanticEvidence } from './semantic-evidence';

export type TakePhase =
  | 'preparing'
  | 'starting'
  | 'listening'
  | 'finalizing'
  | 'stopped';
export interface TakeSnapshot {
  readonly phase: TakePhase;
  readonly topics: readonly Topic[];
  readonly spoken: ReadonlySet<string>;
  readonly manualLocks: ReadonlySet<string>;
  readonly elapsedMs: number;
  readonly error: string | null;
  readonly warning: string | null;
  readonly transcript: readonly TranscriptPart[];
}
export type TakeEvidence =
  | {
      readonly type: 'committed';
      readonly event: Parameters<LiveCaptureOptions['onCommitted']>[0];
    }
  | {
      readonly type: 'completed';
      readonly event: Parameters<LiveCaptureOptions['onCompleted']>[0];
    }
  | {
      readonly type: 'failed';
      readonly event: Parameters<
        LiveCaptureOptions['onTranscriptionFailed']
      >[0];
    };

export function createLiveTake(options: {
  readonly topics: readonly Topic[];
  readonly mintToken: LiveCaptureOptions['mintToken'];
  readonly createCapture?: (callbacks: LiveCaptureOptions) => LiveCapture;
  readonly retirePending: () => void;
  readonly now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  const generation = crypto.randomUUID();
  let active = true;
  let automatic = true;
  let origin = 0;
  let deadline = Infinity;
  let ticker: ReturnType<typeof setInterval> | undefined;
  let cutoff: ReturnType<typeof setTimeout> | undefined;
  let capture: LiveCapture | undefined;
  const evidence = createSemanticEvidence(generation, crypto.randomUUID());
  const transcript = createLiveTranscript();
  const evidenceListeners = new Set<(item: TakeEvidence) => void>();
  const listeners = new Set<() => void>();
  let snapshot: TakeSnapshot = {
    phase: 'preparing',
    topics: Object.freeze(
      options.topics.map((topic) => Object.freeze({ ...topic })),
    ),
    spoken: new Set(),
    manualLocks: new Set(),
    elapsedMs: 0,
    error: null,
    warning: null,
    transcript: transcript.getSnapshot(),
  };
  const publish = (change: Partial<TakeSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  };
  const phase = (): TakePhase => snapshot.phase;
  const eligible = () =>
    active &&
    automatic &&
    (snapshot.phase === 'listening' ||
      (snapshot.phase === 'finalizing' && now() < deadline));
  const retain = (item: TakeEvidence) => {
    if (!eligible()) return;
    evidence.accept(item);
    for (const listener of evidenceListeners) listener(item);
  };
  function display(event: Parameters<typeof transcript.accept>[0]) {
    if (!eligible()) return;
    transcript.accept(event);
    if (snapshot.transcript !== transcript.getSnapshot())
      publish({ transcript: transcript.getSnapshot() });
  }
  function close() {
    automatic = false;
    clearInterval(ticker);
    clearTimeout(cutoff);
    options.retirePending();
    capture?.dispose();
  }
  function fail(
    message = 'Live capture failed. Your marks were retained. Reset before trying again.',
  ) {
    if (!active || snapshot.phase === 'stopped') return;
    const elapsedMs =
      snapshot.phase === 'listening' ? now() - origin : snapshot.elapsedMs;
    automatic = false;
    capture?.stopCapture();
    close();
    publish({
      phase: 'stopped',
      elapsedMs,
      error: message,
    });
  }
  return {
    generation,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getEvidence: evidence.getSnapshot,
    canEvaluate: eligible,
    engineFailed() {
      fail(
        'Engine connection failed. Your marks and elapsed time were retained. Reset before trying again.',
      );
    },
    coverageFailed() {
      if (!eligible()) return;
      fail();
      publish({
        error:
          'Coverage evaluation was not confirmed. Your marks were retained. Reset before trying again.',
      });
    },
    subscribeEvidence(listener: (item: TakeEvidence) => void) {
      evidenceListeners.add(listener);
      return () => {
        evidenceListeners.delete(listener);
      };
    },
    async start(engineReady?: Promise<void>) {
      if (!active || snapshot.phase !== 'preparing') return;
      publish({ phase: 'starting' });
      if (!active || phase() !== 'starting') return;
      try {
        if (engineReady) await engineReady;
        if (!active || phase() !== 'starting') return;
        capture = (options.createCapture ?? createLiveCapture)({
          mintToken: options.mintToken,
          onCommitted: (event) => retain({ type: 'committed', event }),
          onDelta: display,
          onCompleted: (event) => {
            display(event);
            retain({ type: 'completed', event });
          },
          onTranscriptionFailed: (event) => retain({ type: 'failed', event }),
          onFinalCommitIssue: () => {},
          onFatalError: () => fail(),
        });
        await capture.start();
        if (!active || phase() !== 'starting') return;
        origin = now();
        capture.beginCapture();
        publish({ phase: 'listening' });
        if (!active || phase() !== 'listening') return;
        ticker = setInterval(() => {
          if (active && snapshot.phase === 'listening')
            publish({ elapsedMs: now() - origin });
        }, 100);
      } catch {
        fail();
      }
    },
    stop() {
      if (!active) return;
      if (snapshot.phase === 'starting') {
        fail();
        return;
      }
      if (snapshot.phase !== 'listening') return;
      const stoppedAt = now();
      deadline = stoppedAt + 3000;
      capture?.stopCapture();
      clearInterval(ticker);
      publish({ phase: 'finalizing', elapsedMs: stoppedAt - origin });
      if (!active || phase() !== 'finalizing') return;
      cutoff = setTimeout(
        () => {
          if (!active || snapshot.phase !== 'finalizing') return;
          close();
          publish({
            phase: 'stopped',
            warning:
              'The final speech tail may be incomplete. Applied marks were retained.',
          });
        },
        Math.max(0, deadline - now()),
      );
      capture?.commitFinalAudio();
    },
    manualSet(id: string, value: boolean) {
      if (
        !active ||
        !['listening', 'finalizing', 'stopped'].includes(snapshot.phase) ||
        !snapshot.topics.some((topic) => topic.id === id)
      )
        return;
      const spoken = new Set(snapshot.spoken);
      if (value) spoken.add(id);
      else spoken.delete(id);
      publish({ spoken, manualLocks: new Set([...snapshot.manualLocks, id]) });
    },
    automaticMark(id: string) {
      if (
        !eligible() ||
        snapshot.manualLocks.has(id) ||
        !snapshot.topics.some((topic) => topic.id === id)
      )
        return;
      publish({ spoken: new Set([...snapshot.spoken, id]) });
    },
    reset() {
      active = false;
      automatic = false;
      close();
      evidence.clear();
      evidenceListeners.clear();
      transcript.clear();
      publish({
        transcript: transcript.getSnapshot(),
        phase: 'preparing',
        spoken: new Set(),
        manualLocks: new Set(),
        elapsedMs: 0,
        error: null,
        warning: null,
      });
    },
    dispose() {
      active = false;
      close();
      evidence.clear();
      evidenceListeners.clear();
      transcript.clear();
      publish({ transcript: transcript.getSnapshot() });
    },
  };
}
export type LiveTake = ReturnType<typeof createLiveTake>;
