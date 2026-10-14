import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { initialNavigationURL } from '../runner-target.ts';
import { installControlledMicrophoneReference } from './controlled-reference-microphone.ts';
import { observeProtocol } from './evidence.ts';
import { installGreetingAudioTap } from './greeting-audio-tap.ts';
import type {
  AssistantAudioActivity,
  BrowserAudioTimelineSnapshot,
} from './shared-audio-capture.ts';
import { installSharedAudioTimeline } from './shared-audio-capture.ts';

type ObservationSource = 'browser' | 'node' | 'action' | 'audio' | 'protocol';
type ObservationClock =
  | { readonly domain: 'node-monotonic'; readonly elapsedMs: number }
  | { readonly domain: 'browser-performance'; readonly elapsedMs: number };

export type VoiceObservationPayloads = {
  readonly 'bridge-ready': {
    readonly sessionId: string;
    readonly source: 'document';
  };
  readonly 'voice-state': {
    readonly source: 'voice-orb';
    readonly state: string | null;
  };
  readonly status: { readonly source: 'status-region'; readonly count: number };
  readonly captions: {
    readonly source: 'captions-region';
    readonly count: number;
  };
  readonly 'audio-capture-ready': { readonly sampleRate: number };
  readonly 'audio-capture-failure': { readonly reason: string };
  readonly action: {
    readonly name: string;
    readonly phase: 'started' | 'completed' | 'failed';
  };
  readonly 'playback-start': {
    readonly playbackId: string;
    readonly fixture: string;
    readonly delayMs: number;
  };
  readonly 'playback-end': {
    readonly playbackId: string;
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  };
  readonly 'playback-failure': {
    readonly playbackId: string;
    readonly reason: string;
  };
  readonly 'playback-marker': { readonly frame: number };
  readonly 'assistant-activity': AssistantAudioActivity;
  readonly 'protocol-failure': {
    readonly phase: string;
    readonly message: string;
  };
  readonly 'capability-unavailable': {
    readonly capability: string;
    readonly reason: string;
  };
};

export type VoiceObservation = {
  [K in keyof VoiceObservationPayloads]: {
    readonly identity: {
      readonly sessionId: string;
      readonly pageId: string;
    };
    readonly sequence: number;
    readonly source: ObservationSource;
    readonly type: K;
    readonly clock: ObservationClock;
    readonly payload: VoiceObservationPayloads[K];
  };
}[keyof VoiceObservationPayloads];

export type VoiceObservationCursor = {
  readonly sessionId: string;
  readonly pageId: string;
  readonly sequence: number;
};

export type VoicePageSnapshot = {
  readonly url: string;
  readonly readyState: string;
  readonly clock: {
    readonly domain: 'browser-performance';
    readonly elapsedMs: number;
  };
  readonly voiceState: string | null;
  readonly statusCount: number;
  readonly captionCounts: { readonly user: number; readonly assistant: number };
  readonly timeline?: BrowserAudioTimelineSnapshot;
};

type BrowserObservation =
  | {
      readonly type: 'bridge-ready';
      readonly source: 'document';
      readonly clock: number;
      readonly payload: { readonly sessionId: string };
    }
  | {
      readonly type: 'voice-state';
      readonly source: 'voice-orb';
      readonly clock: number;
      readonly payload: { readonly state: string | null };
    }
  | {
      readonly type: 'status';
      readonly source: 'status-region';
      readonly clock: number;
      readonly payload: { readonly count: number };
    }
  | {
      readonly type: 'captions';
      readonly source: 'captions-region';
      readonly clock: number;
      readonly payload: { readonly count: number };
    }
  | {
      readonly type: 'audio-capture-ready';
      readonly source: 'shared-audio-timeline';
      readonly clock: number;
      readonly payload: { readonly sampleRate: number };
    }
  | {
      readonly type: 'audio-capture-failure';
      readonly source: 'shared-audio-timeline';
      readonly clock: number;
      readonly payload: { readonly reason: string };
    };

type BrowserBridgeWindow = Window & {
  __voiceTestObserve?: (event: BrowserObservation) => Promise<void>;
  __voiceTestCleanup?: () => void;
  __voiceGreetingAudio?: { dispose(): void };
  __voiceReferenceMicrophone?: { dispose(): void };
  __voiceAudioTimeline?: {
    mark(): Promise<number>;
    assistantMonitor(frame: number): Promise<AssistantAudioActivity>;
    waitForReady(): Promise<void>;
    snapshot(): Promise<BrowserAudioTimelineSnapshot>;
    dispose?(): Promise<void>;
  };
};

function installObservationBridge(config: { sessionId: string }): void {
  const target = window as BrowserBridgeWindow;
  if (target.__voiceTestCleanup) return;
  const closestElement = (target: Node): Element | null =>
    target instanceof Element ? target : target.parentElement;
  const observers = new MutationObserver((mutations) => {
    const voice = document.querySelector('button.voice-orb');
    const statusCount = document.querySelectorAll('[role="status"]').length;
    const captionNodes = [
      ...document.querySelectorAll('[data-testid="captions"] [data-role]'),
    ];
    const emit = <K extends BrowserObservation['type']>(
      type: K,
      source: Extract<BrowserObservation, { readonly type: K }>['source'],
      payload: Extract<BrowserObservation, { readonly type: K }>['payload'],
    ) => {
      const event = {
        type,
        source,
        clock: performance.now(),
        payload,
      } as Extract<BrowserObservation, { readonly type: K }>;
      void target.__voiceTestObserve?.(event).catch(() => {});
    };
    const targets = new Set(mutations.map((mutation) => mutation.target));
    if (voice && targets.has(voice))
      emit('voice-state', 'voice-orb', {
        state: voice.getAttribute('data-state') ?? null,
      });
    if (
      mutations.some((mutation) =>
        closestElement(mutation.target)?.closest('[role="status"]'),
      )
    )
      emit('status', 'status-region', { count: statusCount });
    if (
      mutations.some((mutation) =>
        closestElement(mutation.target)?.closest('[data-testid="captions"]'),
      )
    )
      emit('captions', 'captions-region', { count: captionNodes.length });
  });
  observers.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });
  target.__voiceTestCleanup = () => observers.disconnect();
  void target
    .__voiceTestObserve?.({
      type: 'bridge-ready',
      source: 'document',
      clock: performance.now(),
      payload: { sessionId: config.sessionId },
    })
    .catch(() => {});
}

export type VoiceDriverOptions = {
  readonly sessionId?: string;
  readonly pageId?: string;
  readonly bufferCapacity?: number;
  readonly nodeNow?: () => number;
  readonly assistantSource?: 'remote' | 'greeting';
  readonly microphoneSource?: 'app' | 'controlled-reference';
};

export type VoiceTestCapabilities = {
  readonly sharedAudioCapture: {
    readonly status: 'not-requested' | 'pending' | 'available' | 'unavailable';
    readonly reason?: string;
  };
  readonly fixturePlayback: {
    readonly status: 'available' | 'unavailable';
    readonly reason?: string;
  };
};

export type WaitForObservationOptions = {
  readonly after?: VoiceObservationCursor;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

const DEFAULT_BUFFER_CAPACITY = 512;
const CLEANUP_TIMEOUT_MS = 3_000;
const PROCESS_TERM_GRACE_MS = 500;
const PROCESS_KILL_GRACE_MS = 1_500;

export type VoiceProcessOptions = {
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
};

/** Starts a bounded subprocess whose cancellation always escalates from SIGTERM to SIGKILL. */
export function startVoiceProcess(
  command: string,
  args: readonly string[],
  options: VoiceProcessOptions,
) {
  const child = spawn(command, [...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const maxBytes = options.maxOutputBytes ?? 1_048_576;
  let outputBytes = 0;
  let failure: Error | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let hardDeadline: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let rejectCloseGrace!: (error: Error) => void;
  const closeGrace = new Promise<never>((_resolve, reject) => {
    rejectCloseGrace = reject;
  });
  void closeGrace.catch(() => {});
  let killRequested = false;
  let intentionalStop = false;
  const closed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    closedAtMs: number;
  }>((resolve) => {
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      clearTimeout(escalation);
      clearTimeout(hardDeadline);
      options.signal?.removeEventListener('abort', abort);
      resolve({ code, signal, closedAtMs: performance.now() });
    });
  });
  const stop = (reason: Error) => {
    failure ??= reason;
    if (killRequested || child.exitCode !== null || child.signalCode !== null)
      return;
    killRequested = true;
    child.kill('SIGTERM');
    escalation = setTimeout(() => child.kill('SIGKILL'), PROCESS_TERM_GRACE_MS);
    escalation.unref?.();
    hardDeadline = setTimeout(
      () =>
        rejectCloseGrace(
          failure ?? new Error('Voice subprocess close timed out'),
        ),
      PROCESS_TERM_GRACE_MS + PROCESS_KILL_GRACE_MS + 500,
    );
    hardDeadline.unref?.();
  };
  const abort = () => stop(new Error('Voice subprocess aborted'));
  child.stdout.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > maxBytes) {
      stop(new Error('Voice subprocess output exceeded its size limit'));
      return;
    }
    stdout.push(chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > maxBytes) {
      stop(new Error('Voice subprocess output exceeded its size limit'));
      return;
    }
  });
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  deadline = setTimeout(
    () =>
      stop(
        new Error(`Voice subprocess timed out after ${options.timeoutMs} ms`),
      ),
    options.timeoutMs,
  );
  deadline.unref?.();

  const settle = async () => {
    const result = await Promise.race([closed, closeGrace]);
    if (
      failure &&
      !(intentionalStop && failure.message === 'Voice subprocess stopped')
    )
      throw failure;
    if (!intentionalStop && result.code !== 0)
      throw new Error(
        `Voice subprocess exited (${result.code ?? result.signal})`,
      );
    return { ...result, stdout: Buffer.concat(stdout).toString('utf8') };
  };
  return {
    closed,
    get intentionalStop() {
      return intentionalStop;
    },
    async completed() {
      return settle();
    },
    async stopAndWait() {
      intentionalStop = true;
      stop(new Error('Voice subprocess stopped'));
      const result = await settle();
      return {
        code: result.code,
        signal: result.signal,
        closedAtMs: result.closedAtMs,
      };
    },
  };
}

/** Shared mechanics for local voice suites; scenario policy remains with consumers. */
export function createVoiceTestDriver(
  page: Page,
  options: VoiceDriverOptions = {},
) {
  const sessionId = options.sessionId ?? randomUUID();
  const pageId = options.pageId ?? randomUUID();
  const capacity = options.bufferCapacity ?? DEFAULT_BUFFER_CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new Error(
      'Voice observation buffer capacity must be a positive integer',
    );
  const startedAt = (options.nodeNow ?? (() => performance.now()))();
  const nodeNow = options.nodeNow ?? (() => performance.now());
  const protocol = observeProtocol(page);
  const observations: VoiceObservation[] = [];
  const subscribers = new Set<(observation: VoiceObservation) => void>();
  const waiters = new Set<{
    readonly predicate: (value: VoiceObservation) => boolean;
    readonly resolve: (value: VoiceObservation) => void;
    readonly reject: (error: Error) => void;
    readonly cleanup: () => void;
  }>();
  let sequence = 0;
  let dropped = 0;
  let disposed = false;
  let pageClosed = false;
  let disposePromise: Promise<void> | undefined;
  let terminalError: Error | undefined;
  let sharedAudioCapture: VoiceTestCapabilities['sharedAudioCapture'] = {
    status: 'not-requested',
  };
  let fixturePlayback: VoiceTestCapabilities['fixturePlayback'] = {
    status: 'available',
  };
  const abortController = new AbortController();
  const managedProcesses = new Set<ReturnType<typeof startVoiceProcess>>();

  const rejectPending = (error: Error) => {
    terminalError ??= error;
    for (const waiter of [...waiters]) {
      waiter.cleanup();
      waiter.reject(terminalError);
    }
    waiters.clear();
  };
  const onClose = () => {
    pageClosed = true;
    terminalError ??= new Error(
      'Voice test page closed before observation completed',
    );
    abortController.abort();
    rejectPending(terminalError);
  };
  page.on('close', onClose);

  const publish = <K extends keyof VoiceObservationPayloads>(
    source: ObservationSource,
    type: K,
    payload: VoiceObservationPayloads[K],
    clock: ObservationClock,
  ) => {
    if (disposed || pageClosed) return undefined;
    const value = {
      identity: { sessionId, pageId },
      sequence: ++sequence,
      source,
      type,
      clock,
      payload,
    } as unknown as VoiceObservation;
    observations.push(value);
    if (observations.length > capacity) {
      observations.shift();
      dropped++;
    }
    for (const waiter of [...waiters]) {
      if (waiter.predicate(value)) {
        waiter.cleanup();
        waiters.delete(waiter);
        waiter.resolve(value);
      }
    }
    // Callback work is intentionally detached from Playwright's binding callback.
    for (const subscriber of [...subscribers])
      queueMicrotask(() => {
        if (subscribers.has(subscriber)) {
          try {
            void Promise.resolve(subscriber(value)).catch((error: unknown) =>
              console.error('Voice observation subscriber failed:', error),
            );
          } catch (error) {
            console.error('Voice observation subscriber failed:', error);
          }
        }
      });
    return value;
  };

  const markAudioUnavailable = (reason: string) => {
    if (sharedAudioCapture.status === 'unavailable') return;
    sharedAudioCapture = { status: 'unavailable', reason };
    publish(
      'node',
      'capability-unavailable',
      {
        capability: 'shared-audio-capture',
        reason,
      },
      { domain: 'node-monotonic', elapsedMs: nodeNow() - startedAt },
    );
  };
  const pendingBrowserSetup = new Set<Promise<unknown>>();
  const trackBrowserSetup = <T>(operation: Promise<T>) => {
    pendingBrowserSetup.add(operation);
    void operation.then(
      () => pendingBrowserSetup.delete(operation),
      () => pendingBrowserSetup.delete(operation),
    );
    return operation;
  };
  const bridgeReady = page.exposeBinding(
    '__voiceTestObserve',
    (_source, event: BrowserObservation) => {
      if (!event || !Number.isFinite(event.clock)) return;
      if (event.type === 'audio-capture-ready')
        sharedAudioCapture = { status: 'available' };
      if (event.type === 'audio-capture-failure') {
        sharedAudioCapture = {
          status: 'unavailable',
          reason: event.payload.reason,
        };
        publish(
          'browser',
          'capability-unavailable',
          {
            capability: 'shared-audio-capture',
            reason: event.payload.reason,
          },
          { domain: 'browser-performance', elapsedMs: event.clock },
        );
      }
      const clock = {
        domain: 'browser-performance' as const,
        elapsedMs: event.clock,
      };
      switch (event.type) {
        case 'bridge-ready':
          publish(
            'browser',
            event.type,
            { ...event.payload, source: 'document' },
            clock,
          );
          break;
        case 'voice-state':
          publish(
            'browser',
            event.type,
            { ...event.payload, source: 'voice-orb' },
            clock,
          );
          break;
        case 'status':
          publish(
            'browser',
            event.type,
            { ...event.payload, source: 'status-region' },
            clock,
          );
          break;
        case 'captions':
          publish(
            'browser',
            event.type,
            { ...event.payload, source: 'captions-region' },
            clock,
          );
          break;
        case 'audio-capture-ready':
          publish('audio', event.type, event.payload, clock);
          break;
        case 'audio-capture-failure':
          publish('audio', event.type, event.payload, clock);
          break;
      }
    },
  );

  const awaitActive = <T>(operation: Promise<T>) => {
    if (abortController.signal.aborted)
      return Promise.reject(
        terminalError ?? new Error('Voice test driver is unavailable'),
      );
    return new Promise<T>((resolve, reject) => {
      const onAbort = () =>
        reject(terminalError ?? new Error('Voice test driver is unavailable'));
      abortController.signal.addEventListener('abort', onAbort, { once: true });
      operation
        .then(resolve, reject)
        .finally(() =>
          abortController.signal.removeEventListener('abort', onAbort),
        );
    });
  };

  const cursor = (): VoiceObservationCursor => ({
    sessionId,
    pageId,
    sequence,
  });
  const findAfter = (
    after: VoiceObservationCursor,
    predicate: (value: VoiceObservation) => boolean,
  ) => {
    if (after.sessionId !== sessionId || after.pageId !== pageId)
      throw new Error(
        'Voice observation cursor belongs to a different page or session',
      );
    const oldest = observations[0];
    if (oldest && after.sequence < oldest.sequence - 1)
      throw new Error(
        `Voice observation cursor expired after ${dropped} buffer overflow event(s)`,
      );
    return observations.find(
      (value) => value.sequence > after.sequence && predicate(value),
    );
  };

  return {
    page,
    sessionId,
    pageId,
    signal: abortController.signal,
    protocol,
    get capabilities(): VoiceTestCapabilities {
      return {
        sharedAudioCapture: { ...sharedAudioCapture },
        fixturePlayback: { ...fixturePlayback },
      };
    },
    startProcess(
      command: string,
      args: readonly string[],
      processOptions: Omit<VoiceProcessOptions, 'signal'>,
    ) {
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      const child = startVoiceProcess(command, args, {
        ...processOptions,
        signal: abortController.signal,
      });
      managedProcesses.add(child);
      void child.closed.then(() => managedProcesses.delete(child));
      return child;
    },
    startPlayback(
      binary: string,
      fixture: string,
      playbackOptions: {
        readonly delayMs: number;
        readonly timeoutMs: number;
        readonly maxOutputBytes?: number;
      },
    ) {
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      if (
        !Number.isSafeInteger(playbackOptions.delayMs) ||
        playbackOptions.delayMs < 0
      )
        throw new Error(
          'Playback delay must be a nonnegative integer number of milliseconds',
        );
      const playbackId = randomUUID();
      const fixtureName = fixture.split(/[\\/]/).at(-1) ?? 'audio-fixture';
      publish(
        'node',
        'playback-start',
        {
          playbackId,
          fixture: fixtureName,
          delayMs: playbackOptions.delayMs,
        },
        { domain: 'node-monotonic', elapsedMs: nodeNow() - startedAt },
      );
      const child = this.startProcess(
        binary,
        [
          'play',
          '--target',
          'pipewire',
          '--delay',
          `${playbackOptions.delayMs / 1000}s`,
          '--file',
          fixture,
        ],
        {
          timeoutMs: playbackOptions.timeoutMs,
          maxOutputBytes: playbackOptions.maxOutputBytes,
        },
      );
      void child.closed.then((result) => {
        publish(
          'node',
          'playback-end',
          { playbackId, code: result.code, signal: result.signal },
          {
            domain: 'node-monotonic',
            elapsedMs: nodeNow() - startedAt,
          },
        );
        if (result.code !== 0 && !child.intentionalStop) {
          fixturePlayback = {
            status: 'unavailable',
            reason: 'subprocess-failed',
          };
          publish(
            'node',
            'playback-failure',
            { playbackId, reason: 'subprocess-failed' },
            {
              domain: 'node-monotonic',
              elapsedMs: nodeNow() - startedAt,
            },
          );
          publish(
            'node',
            'capability-unavailable',
            {
              capability: 'fixture-playback',
              reason: 'subprocess-failed',
            },
            { domain: 'node-monotonic', elapsedMs: nodeNow() - startedAt },
          );
        }
      });
      return child;
    },
    cursor,
    get observations() {
      return observations.slice();
    },
    get bufferStatus() {
      return {
        capacity,
        size: observations.length,
        dropped,
        oldestSequence: observations[0]?.sequence ?? null,
        newestSequence: observations.at(-1)?.sequence ?? sequence,
      };
    },
    subscribe(callback: (observation: VoiceObservation) => void) {
      if (disposed) throw new Error('Voice test driver has been disposed');
      subscribers.add(callback);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        subscribers.delete(callback);
      };
    },
    async waitForObservation(
      predicate: (observation: VoiceObservation) => boolean,
      waitOptions: WaitForObservationOptions = {},
    ) {
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      const after = waitOptions.after ?? cursor();
      const existing = findAfter(after, predicate);
      if (existing) return existing;
      if (waitOptions.signal?.aborted)
        throw new Error('Voice observation wait aborted');
      const timeoutMs = waitOptions.timeoutMs ?? 10_000;
      return new Promise<VoiceObservation>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onAbort = () => {
          cleanup();
          waiters.delete(waiter);
          reject(new Error('Voice observation wait aborted'));
        };
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          waitOptions.signal?.removeEventListener('abort', onAbort);
        };
        const waiter = {
          predicate: (value: VoiceObservation) =>
            value.sequence > after.sequence && predicate(value),
          resolve,
          reject,
          cleanup,
        };
        waiters.add(waiter);
        waitOptions.signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => {
          waiters.delete(waiter);
          cleanup();
          reject(
            new Error(
              `Timed out waiting for voice observation after sequence ${after.sequence}`,
            ),
          );
        }, timeoutMs);
        timer.unref?.();
        // Recheck after registration to close the cursor/listener race.
        const raced = findAfter(after, predicate);
        if (raced) {
          waiters.delete(waiter);
          cleanup();
          resolve(raced);
        }
      });
    },
    async navigate(baseURL: string | undefined, captureAudio = true) {
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      sharedAudioCapture = captureAudio
        ? { status: 'pending' }
        : { status: 'not-requested' };
      if (!captureAudio) markAudioUnavailable('not-requested-by-consumer');
      await awaitActive(bridgeReady);
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      const observationScript = trackBrowserSetup(
        page.addInitScript(installObservationBridge, { sessionId }),
      );
      await awaitActive(observationScript);
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      if (captureAudio) {
        const audioScript = trackBrowserSetup(
          page.addInitScript(installSharedAudioTimeline, {
            assistantSource: options.assistantSource ?? 'remote',
            microphoneSource: options.microphoneSource ?? 'app',
          }),
        );
        await awaitActive(audioScript);
        if (options.microphoneSource === 'controlled-reference')
          await awaitActive(
            trackBrowserSetup(
              page.addInitScript(installControlledMicrophoneReference),
            ),
          );
        if (options.assistantSource === 'greeting')
          await awaitActive(
            trackBrowserSetup(page.addInitScript(installGreetingAudioTap)),
          );
      }
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      const url = initialNavigationURL(baseURL);
      const safeTarget = new URL(url);
      publish(
        'action',
        'action',
        {
          name: `navigate:${safeTarget.origin}${safeTarget.pathname}`,
          phase: 'started',
        },
        { domain: 'node-monotonic', elapsedMs: nodeNow() - startedAt },
      );
      await awaitActive(trackBrowserSetup(page.goto(url)));
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
    },
    async action<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      publish(
        'action',
        'action',
        { name, phase: 'started' },
        {
          domain: 'node-monotonic',
          elapsedMs: nodeNow() - startedAt,
        },
      );
      try {
        const result = await new Promise<T>((resolve, reject) => {
          if (abortController.signal.aborted) {
            reject(terminalError ?? new Error('Voice test action aborted'));
            return;
          }
          const onAbort = () =>
            reject(terminalError ?? new Error('Voice test action aborted'));
          abortController.signal.addEventListener('abort', onAbort, {
            once: true,
          });
          Promise.resolve()
            .then(run)
            .then(resolve, reject)
            .finally(() =>
              abortController.signal.removeEventListener('abort', onAbort),
            );
        });
        publish(
          'action',
          'action',
          { name, phase: 'completed' },
          {
            domain: 'node-monotonic',
            elapsedMs: nodeNow() - startedAt,
          },
        );
        return result;
      } catch (error) {
        publish(
          'action',
          'action',
          { name, phase: 'failed' },
          { domain: 'node-monotonic', elapsedMs: nodeNow() - startedAt },
        );
        throw error;
      }
    },
    async evaluate<T, A = undefined>(
      name: string,
      action: (arg: A) => T | Promise<T>,
      arg?: A,
    ): Promise<T> {
      return this.action(
        name,
        () => page.evaluate(action as never, arg as never) as Promise<T>,
      );
    },
    async waitForAudioReady() {
      try {
        await this.evaluate('audio:wait-ready', async () => {
          const timeline = (window as BrowserBridgeWindow).__voiceAudioTimeline;
          if (!timeline) throw new Error('Shared audio capture is unavailable');
          await timeline.waitForReady();
        });
      } catch (error) {
        publish(
          'audio',
          'audio-capture-failure',
          { reason: 'readiness-failed' },
          {
            domain: 'node-monotonic',
            elapsedMs: nodeNow() - startedAt,
          },
        );
        markAudioUnavailable('audio-capture-readiness-failed');
        throw error;
      }
    },
    async snapshotAudio(): Promise<BrowserAudioTimelineSnapshot> {
      try {
        return await this.evaluate('audio:snapshot', async () => {
          const timeline = (window as BrowserBridgeWindow).__voiceAudioTimeline;
          if (!timeline) throw new Error('Shared audio capture is unavailable');
          return timeline.snapshot();
        });
      } catch (error) {
        markAudioUnavailable('audio-capture-snapshot-failed');
        throw error;
      }
    },
    async snapshot(includeAudio = true): Promise<VoicePageSnapshot> {
      if (disposed || pageClosed)
        throw terminalError ?? new Error('Voice test driver is unavailable');
      return this.action('snapshot', () =>
        page.evaluate(async (withAudio) => {
          const target = window as BrowserBridgeWindow;
          const captions = [
            ...document.querySelectorAll(
              '[data-testid="captions"] [data-role]',
            ),
          ];
          const timeline = withAudio
            ? await target.__voiceAudioTimeline?.snapshot()
            : undefined;
          return {
            url: `${location.origin}${location.pathname}`,
            readyState: document.readyState,
            clock: {
              domain: 'browser-performance',
              elapsedMs: performance.now(),
            },
            voiceState:
              document
                .querySelector('button.voice-orb')
                ?.getAttribute('data-state') ?? null,
            statusCount: document.querySelectorAll('[role="status"]').length,
            captionCounts: {
              user: captions.filter(
                (node) => node.getAttribute('data-role') === 'user',
              ).length,
              assistant: captions.filter(
                (node) => node.getAttribute('data-role') === 'assistant',
              ).length,
            },
            ...(timeline ? { timeline } : {}),
          };
        }, includeAudio),
      );
    },
    async markPlaybackStart() {
      const frame = await this.evaluate('audio:mark', async () => {
        const timeline = (window as BrowserBridgeWindow).__voiceAudioTimeline;
        if (!timeline)
          throw new Error('Shared audio timeline is not installed');
        return timeline.mark();
      });
      publish(
        'audio',
        'playback-marker',
        { frame },
        { domain: 'node-monotonic', elapsedMs: nodeNow() - startedAt },
      );
      return frame;
    },
    async assistantActivity(fromFrame: number) {
      const activity = await this.evaluate(
        'audio:assistant-monitor',
        async (frame) => {
          const timeline = (window as BrowserBridgeWindow).__voiceAudioTimeline;
          if (!timeline)
            throw new Error('Shared audio timeline is not installed');
          return timeline.assistantMonitor(frame);
        },
        fromFrame,
      );
      publish('audio', 'assistant-activity', activity, {
        domain: 'node-monotonic',
        elapsedMs: nodeNow() - startedAt,
      });
      return activity;
    },
    async evidence() {
      let page: VoicePageSnapshot | null = null;
      try {
        page = await this.snapshot(false);
      } catch {}
      return {
        identity: { sessionId, pageId },
        observations: observations.slice(),
        buffer: this.bufferStatus,
        protocol: protocol.snapshot(),
        page,
      };
    },
    assertHealthy(phase: string, cause?: unknown) {
      try {
        protocol.assertHealthy(phase, cause);
      } catch (error) {
        publish(
          'protocol',
          'protocol-failure',
          {
            phase,
            message: error instanceof Error ? error.message : String(error),
          },
          { domain: 'node-monotonic', elapsedMs: nodeNow() - startedAt },
        );
        throw error;
      }
    },
    async dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      terminalError ??= new Error('Voice test driver disposed');
      abortController.abort();
      rejectPending(terminalError);
      disposePromise = (async () => {
        const processCleanup = Promise.allSettled(
          [...managedProcesses].map((child) => child.closed),
        );
        const browserCleanup = pageClosed
          ? Promise.resolve()
          : Promise.allSettled([...pendingBrowserSetup])
              .then(() => bridgeReady)
              .then(() =>
                page.evaluate(async () => {
                  const target = window as BrowserBridgeWindow;
                  target.__voiceTestCleanup?.();
                  target.__voiceTestCleanup = undefined;
                  target.__voiceGreetingAudio?.dispose();
                  target.__voiceReferenceMicrophone?.dispose();
                  await target.__voiceAudioTimeline?.dispose?.();
                  target.__voiceTestObserve = undefined;
                }),
              )
              .catch(() => {});
        await Promise.race([
          Promise.all([processCleanup, browserCleanup]),
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, CLEANUP_TIMEOUT_MS);
            timer.unref?.();
          }),
        ]);
        page.off('close', onClose);
        protocol.dispose();
        subscribers.clear();
        observations.length = 0;
      })();
      return disposePromise;
    },
  };
}

export type VoiceTestDriver = ReturnType<typeof createVoiceTestDriver>;
