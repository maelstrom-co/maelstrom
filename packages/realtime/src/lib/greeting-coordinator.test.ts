import { describe, expect, it } from 'bun:test';
import type { AssistantMessageOutcome } from '@maelstrom-co/client';
import type { MessageId, SessionId } from '@maelstrom-co/protocol';
import {
  MessageId as brandMessageId,
  SessionId as brandSessionId,
} from '@maelstrom-co/protocol';

import {
  GreetingCoordinator,
  type GreetingRunDisposition,
} from './greeting-coordinator.js';
import type {
  GreetingSpeechResult,
  RealtimeGreetingAdapter,
} from './realtime-session/provider-adapter.types.js';
import type { RealtimeInstance } from './realtime-session/realtime-session.types.js';

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface FakeInstance {
  readonly instance: RealtimeInstance;
  readonly ackCalls: Array<{ id: MessageId; message: string }>;
  readonly engineSubscriberCount: number;
  setConnected(connected: boolean): void;
  setAck(
    result:
      | AssistantMessageOutcome
      | Error
      | (() => Promise<AssistantMessageOutcome>),
  ): void;
  gateAck(): () => void;
}

function makeFakeInstance(initiallyConnected = true): FakeInstance {
  const ackCalls: Array<{ id: MessageId; message: string }> = [];
  const engineHandlers = new Set<(connected: boolean) => void>();
  let connected = initiallyConnected;
  let ackResult:
    | AssistantMessageOutcome
    | Error
    | (() => Promise<AssistantMessageOutcome>) = 'inserted';
  let ackGate: Promise<void> | undefined;

  const instance: RealtimeInstance = {
    submitIntent: async () => ({}),
    waitForIdle: async () => {},
    getStructuralSnapshot: () => ({
      instances: [],
      layout: null,
      layoutMode: 'grid',
      chartDimensions: { rows: 8, columns: 12 },
    }),
    getCapabilitySnapshot: () => ({ vessels: [] }),
    onSettled: () => () => {},
    addAssistantMessageAcknowledged: async (args) => {
      ackCalls.push(args);
      if (ackGate) {
        await ackGate;
        ackGate = undefined;
      }
      if (typeof ackResult === 'function') return ackResult();
      if (ackResult instanceof Error) throw ackResult;
      return ackResult;
    },
    observeEngineConnection: (cb) => {
      engineHandlers.add(cb);
      cb(connected);
      return () => {
        engineHandlers.delete(cb);
      };
    },
  };

  return {
    instance,
    ackCalls,
    get engineSubscriberCount() {
      return engineHandlers.size;
    },
    setConnected(next) {
      connected = next;
      for (const cb of engineHandlers) cb(next);
    },
    setAck(result) {
      ackResult = result;
    },
    gateAck() {
      let release!: () => void;
      ackGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

interface FakeAdapter {
  readonly adapter: RealtimeGreetingAdapter;
  readonly activateCalls: number;
  readonly speakCalls: Array<{
    id: MessageId;
    text: string;
    signal: AbortSignal;
    onPlaybackStart?: () => void;
  }>;
  setSpeak(
    result: GreetingSpeechResult | (() => Promise<GreetingSpeechResult>),
  ): void;
}

function makeFakeAdapter(): FakeAdapter {
  const speakCalls: Array<{
    id: MessageId;
    text: string;
    signal: AbortSignal;
    onPlaybackStart?: () => void;
  }> = [];
  let activateCalls = 0;
  let speakResult:
    | GreetingSpeechResult
    | (() => Promise<GreetingSpeechResult>) = 'accepted';

  const adapter: RealtimeGreetingAdapter = {
    connect: async () => {},
    disconnect: async () => {},
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: () => {},
    on: () => () => {},
    activateAudio() {
      activateCalls += 1;
    },
    async speakAssistantText(args) {
      speakCalls.push(args);
      const result =
        typeof speakResult === 'function' ? await speakResult() : speakResult;
      if (result === 'accepted') args.onPlaybackStart?.();
      return result;
    },
  };

  return {
    adapter,
    get activateCalls() {
      return activateCalls;
    },
    speakCalls,
    setSpeak(result) {
      speakResult = result;
    },
  };
}

function session(id: string): SessionId {
  return brandSessionId(id);
}

describe('GreetingCoordinator', () => {
  it('derives a stable greeting id from the session id without hashing', () => {
    const coordinator = new GreetingCoordinator();
    const a = session('sess-a');
    const b = session('sess-b');
    expect(coordinator.greetingIdFor(a)).toBe(
      brandMessageId('greeting:sess-a'),
    );
    expect(coordinator.greetingIdFor(b)).toBe(
      brandMessageId('greeting:sess-b'),
    );
    expect(coordinator.greetingIdFor(a)).not.toBe(coordinator.greetingIdFor(b));
  });

  it('publishes the caption only after persisted speech starts', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const order: string[] = [];
    const release = fake.gateAck();

    fake.setAck(async () => {
      order.push('ack');
      return 'inserted';
    });
    adapter.setSpeak(async () => {
      order.push('speak');
      return 'accepted';
    });

    const run = coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (text) => {
        order.push(`caption:${text}`);
      },
    });

    await flushTasks();
    expect(order).toEqual([]);
    expect(fake.ackCalls).toHaveLength(1);

    release();
    await run;

    expect(order).toEqual(['ack', 'speak', 'caption:Hello']);
  });

  it('is a no-op after a full success for the same session', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    const ctx = {
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (text: string) => captions.push(text),
    };

    await coordinator.run(ctx);
    await coordinator.run(ctx);

    expect(fake.ackCalls).toHaveLength(1);
    expect(captions).toEqual(['Hello']);
    expect(adapter.speakCalls).toHaveLength(1);
  });

  it('retries speech after not_started and publishes only the accepted playback caption', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    adapter.setSpeak('not_started');

    const ctx = {
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (text: string) => captions.push(text),
    };

    await coordinator.run(ctx);
    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toHaveLength(1);

    adapter.setSpeak('accepted');
    await coordinator.run(ctx);

    expect(captions).toEqual(['Hello']);
    expect(adapter.speakCalls).toHaveLength(2);
    // Second run re-acks (retained inserted / dedupe path); caption stays once.
    expect(fake.ackCalls).toHaveLength(2);
  });

  it('resets proofs and greets again for a new session id', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];

    await coordinator.run({
      sessionId: session('a'),
      text: 'Hi A',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await coordinator.run({
      sessionId: session('b'),
      text: 'Hi B',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });

    expect(fake.ackCalls.map((c) => c.id)).toEqual([
      brandMessageId('greeting:a'),
      brandMessageId('greeting:b'),
    ]);
    expect(captions).toEqual(['Hi A', 'Hi B']);
    expect(adapter.speakCalls).toHaveLength(2);
  });

  it('suppresses caption and speech when ack is deduped without retained inserted', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    fake.setAck('deduped');

    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });

    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
    // Second run short-circuits on suppressed — no further ack.
    expect(fake.ackCalls).toHaveLength(1);
  });

  it('continues in-page work when a later ack is deduped after retained inserted', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    let ackCalls = 0;
    fake.setAck(async () => {
      ackCalls += 1;
      return ackCalls === 1 ? 'inserted' : 'deduped';
    });
    adapter.setSpeak('not_started');

    const ctx = {
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t: string) => captions.push(t),
    };

    await coordinator.run(ctx);
    adapter.setSpeak('accepted');
    await coordinator.run(ctx);

    expect(captions).toEqual(['Hello']);
    expect(adapter.speakCalls).toHaveLength(2);
    expect(fake.ackCalls).toHaveLength(2);
  });

  it('returns persist to unstarted on rejection and retries on the next run', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    fake.setAck(new Error('history unavailable'));

    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
    expect(fake.ackCalls).toHaveLength(1);

    fake.setAck('inserted');
    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });

    expect(fake.ackCalls).toHaveLength(2);
    expect(captions).toEqual(['Hello']);
    expect(adapter.speakCalls).toHaveLength(1);
  });

  it('waits on the engine barrier and proceeds from an already-connected snapshot', async () => {
    const coordinator = new GreetingCoordinator();
    const disconnected = makeFakeInstance(false);
    const adapter = makeFakeAdapter();
    const captions: string[] = [];

    const run = coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: disconnected.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    expect(disconnected.ackCalls).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);

    disconnected.setConnected(true);
    await run;
    expect(disconnected.ackCalls).toHaveLength(1);
    expect(captions).toEqual(['Hello']);

    // Already-connected snapshot proceeds without waiting.
    const connected = makeFakeInstance(true);
    const adapter2 = makeFakeAdapter();
    await coordinator.run({
      sessionId: session('s2'),
      text: 'Hi',
      instance: connected.instance,
      adapter: adapter2.adapter,
      signal: new AbortController().signal,
      emitTranscript: () => {},
    });
    expect(connected.ackCalls).toHaveLength(1);
    expect(adapter2.speakCalls).toHaveLength(1);
  });

  it('unsubscribes the engine barrier when the snapshot is already connected', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance(true);
    const adapter = makeFakeAdapter();

    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: () => {},
    });

    // Synchronous connected snapshot must not leak the observeEngineConnection
    // listener (finish must not race ahead of unsubscribe assignment).
    expect(fake.engineSubscriberCount).toBe(0);
  });

  it('shares one in-flight persist and exactly one speech call across concurrent runs', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    const release = fake.gateAck();
    fake.setAck('inserted');

    const ctx = {
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t: string) => captions.push(t),
    };

    const first = coordinator.run(ctx);
    const second = coordinator.run(ctx);
    await flushTasks();
    expect(fake.ackCalls).toHaveLength(1);

    release();
    await Promise.all([first, second]);

    expect(fake.ackCalls).toHaveLength(1);
    expect(captions).toEqual(['Hello']);
    expect(adapter.speakCalls).toHaveLength(1);
  });

  it('aborts the engine barrier without side effects so a later generation retries', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance(false);
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    const controller = new AbortController();

    const run = coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: controller.signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    controller.abort();
    await run;

    expect(fake.ackCalls).toEqual([]);
    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
    expect(fake.engineSubscriberCount).toBe(0);

    // Later generation: engine is ready now; retained state is still unstarted.
    fake.setConnected(true);
    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    expect(fake.ackCalls).toHaveLength(1);
    expect(captions).toEqual(['Hello']);
  });

  it('short-circuits suppressed even when speech was never accepted', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    fake.setAck('deduped');

    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: () => {},
    });

    fake.setAck('inserted');
    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: () => {},
    });

    expect(fake.ackCalls).toHaveLength(1);
    expect(adapter.speakCalls).toEqual([]);
  });

  it('ignores a stale session-A ack after session B adopts (no proof corruption)', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];

    // Per-call gated outcomes: A resolves 'inserted' late; B resolves 'deduped'
    // with no retained inserted for B. Without generation scoping, late A would
    // promote B to inserted (caption/speak without B in engine history) or a
    // late suppressed A would block B forever.
    const releases: Array<() => void> = [];
    const outcomes: AssistantMessageOutcome[] = ['inserted', 'deduped'];
    let ackIndex = 0;
    fake.setAck(async () => {
      const i = ackIndex;
      ackIndex += 1;
      await new Promise<void>((resolve) => {
        releases[i] = resolve;
      });
      return outcomes[i] ?? 'inserted';
    });

    const runA = coordinator.run({
      sessionId: session('a'),
      text: 'Hi A',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    expect(fake.ackCalls).toHaveLength(1);
    expect(releases[0]).toBeTypeOf('function');

    const runB = coordinator.run({
      sessionId: session('b'),
      text: 'Hi B',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    // B issued its own ack (A's in-flight pointer was dropped on adopt).
    expect(fake.ackCalls).toHaveLength(2);
    expect(fake.ackCalls[1]?.id).toBe(brandMessageId('greeting:b'));
    expect(releases[1]).toBeTypeOf('function');

    // Let B finish first (deduped → suppressed), then stale A settles inserted.
    releases[1]!();
    await flushTasks();
    releases[0]!();
    await Promise.all([runA, runB]);

    // B suppressed; stale A must not caption/speak or un-suppress B.
    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);

    // B stays suppressed on a later run (stale A did not leave inserted).
    fake.setAck('inserted');
    await coordinator.run({
      sessionId: session('b'),
      text: 'Hi B',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    expect(fake.ackCalls).toHaveLength(2); // no new ack — still suppressed
    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
  });

  it('stops a stale continuation after a playback-start caption adopts a new session', async () => {
    const coordinator = new GreetingCoordinator();
    const fakeA = makeFakeInstance();
    const fakeB = makeFakeInstance();
    const adapterA = makeFakeAdapter();
    const adapterB = makeFakeAdapter();
    const captions: string[] = [];
    let runB: Promise<GreetingRunDisposition> | undefined;

    await coordinator.run({
      sessionId: session('a'),
      text: 'Hi A',
      instance: fakeA.instance,
      adapter: adapterA.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => {
        captions.push(t);
        // Re-enter synchronously during A's playback-start caption: adopt B.
        runB = coordinator.run({
          sessionId: session('b'),
          text: 'Hi B',
          instance: fakeB.instance,
          adapter: adapterB.adapter,
          signal: new AbortController().signal,
          emitTranscript: (tb) => captions.push(tb),
        });
      },
    });

    // Drain the re-entrant B run started from the caption handler.
    await flushTasks();
    await flushTasks();
    await runB;

    // A had already started presentation when its caption adopted B. B then
    // presents exactly once with its own greeting id.
    expect(adapterA.speakCalls).toHaveLength(1);
    expect(adapterB.speakCalls).toHaveLength(1);
    expect(adapterB.speakCalls[0]?.id).toBe(brandMessageId('greeting:b'));
    expect(adapterB.speakCalls[0]?.text).toBe('Hi B');
    expect(captions).toEqual(['Hi A', 'Hi B']);
    expect(fakeA.ackCalls.map((c) => c.id)).toEqual([
      brandMessageId('greeting:a'),
    ]);
    expect(fakeB.ackCalls.map((c) => c.id)).toEqual([
      brandMessageId('greeting:b'),
    ]);
  });

  it('does not let a stale finally clear a newer session in-flight promise', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];

    const releases: Array<() => void> = [];
    let ackIndex = 0;
    fake.setAck(async () => {
      const i = ackIndex;
      ackIndex += 1;
      await new Promise<void>((resolve) => {
        releases[i] = resolve;
      });
      return 'inserted';
    });

    const runA = coordinator.run({
      sessionId: session('a'),
      text: 'Hi A',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    expect(fake.ackCalls).toHaveLength(1);

    const runB = coordinator.run({
      sessionId: session('b'),
      text: 'Hi B',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    expect(fake.ackCalls).toHaveLength(2);

    // Concurrent same-session run must share B's in-flight — no third ack.
    const adapterShared = makeFakeAdapter();
    const runB2 = coordinator.run({
      sessionId: session('b'),
      text: 'Hi B',
      instance: fake.instance,
      adapter: adapterShared.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    expect(fake.ackCalls).toHaveLength(2);

    // A settles first. Its finally must not clear B's in-flight pointer.
    releases[0]!();
    await flushTasks();
    expect(fake.ackCalls).toHaveLength(2);

    releases[1]!();
    await Promise.all([runA, runB, runB2]);

    expect(fake.ackCalls).toHaveLength(2);
    expect(fake.ackCalls.map((c) => c.id)).toEqual([
      brandMessageId('greeting:a'),
      brandMessageId('greeting:b'),
    ]);
    // Only B captioned (A abandoned by session adopt); exactly one caption.
    expect(captions).toEqual(['Hi B']);
    // B and B2 share one speech attempt with B's greeting id.
    const speakIds = [
      ...adapter.speakCalls.map((c) => c.id),
      ...adapterShared.speakCalls.map((c) => c.id),
    ];
    expect(speakIds).toHaveLength(1);
    expect(speakIds[0]).toBe(brandMessageId('greeting:b'));
    expect(ackIndex).toBe(2);
  });

  it('keeps accepted terminal after a post-send abort so reconnect does not retry', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    const controller = new AbortController();

    adapter.setSpeak(async () => {
      controller.abort();
      return 'accepted';
    });

    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: controller.signal,
      emitTranscript: (t) => captions.push(t),
    });

    expect(captions).toEqual(['Hello']);
    expect(adapter.speakCalls).toHaveLength(1);

    // Later generation / reconnect must not re-speak.
    await coordinator.run({
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    expect(adapter.speakCalls).toHaveLength(1);
    expect(captions).toEqual(['Hello']);
  });

  it('does not concurrently re-invoke speech for not_started in the same generation', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    let releaseSpeak!: () => void;
    const speakGate = new Promise<void>((resolve) => {
      releaseSpeak = resolve;
    });
    adapter.setSpeak(async () => {
      await speakGate;
      return 'not_started';
    });

    const ctx = {
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t: string) => captions.push(t),
    };

    const first = coordinator.run(ctx);
    const second = coordinator.run(ctx);
    await flushTasks();
    expect(adapter.speakCalls).toHaveLength(1);

    releaseSpeak();
    await Promise.all([first, second]);
    expect(adapter.speakCalls).toHaveLength(1);
    expect(captions).toEqual([]);

    // Later generation may retry not_started.
    adapter.setSpeak('accepted');
    await coordinator.run(ctx);
    expect(adapter.speakCalls).toHaveLength(2);
    expect(captions).toEqual(['Hello']);
  });

  it('leaves speech retriable when the adapter throws before a verdict', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];
    adapter.setSpeak(async () => {
      throw new Error('adapter boom');
    });

    const ctx = {
      sessionId: session('s1'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t: string) => captions.push(t),
    };

    await coordinator.run(ctx);
    expect(adapter.speakCalls).toHaveLength(1);
    expect(captions).toEqual([]);

    adapter.setSpeak('accepted');
    await coordinator.run(ctx);
    expect(adapter.speakCalls).toHaveLength(2);
    expect(captions).toEqual(['Hello']);
  });

  it('ignores a stale session-A speech completion after session B adopts', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const captions: string[] = [];

    const speakReleases: Array<() => void> = [];
    let speakIndex = 0;
    const outcomes: GreetingSpeechResult[] = ['accepted', 'not_started'];
    adapter.setSpeak(async () => {
      const i = speakIndex;
      speakIndex += 1;
      await new Promise<void>((resolve) => {
        speakReleases[i] = resolve;
      });
      return outcomes[i] ?? 'accepted';
    });

    const runA = coordinator.run({
      sessionId: session('a'),
      text: 'Hi A',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    expect(adapter.speakCalls).toHaveLength(1);
    expect(speakReleases[0]).toBeTypeOf('function');

    const runB = coordinator.run({
      sessionId: session('b'),
      text: 'Hi B',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    await flushTasks();
    expect(adapter.speakCalls).toHaveLength(2);
    expect(speakReleases[1]).toBeTypeOf('function');

    // B finishes not_started first; stale A then settles accepted.
    speakReleases[1]!();
    await flushTasks();
    speakReleases[0]!();
    await Promise.all([runA, runB]);

    expect(captions).toEqual([]);

    // B stays not_started (retriable); stale A must not mark B accepted.
    adapter.setSpeak('accepted');
    await coordinator.run({
      sessionId: session('b'),
      text: 'Hi B',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: (t) => captions.push(t),
    });
    expect(adapter.speakCalls).toHaveLength(3);
    expect(adapter.speakCalls[2]?.id).toBe(brandMessageId('greeting:b'));
    expect(captions).toEqual(['Hi B']);
  });

  it('records Skip synchronously and prevents side effects across every pre-speech race', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance(false);
    const adapter = makeFakeAdapter();
    const controller = new AbortController();
    const captions: string[] = [];
    const run = coordinator.run({
      sessionId: session('skipped'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: controller.signal,
      emitTranscript: (text) => captions.push(text),
    });
    await flushTasks();

    expect(coordinator.skip(session('skipped'))).toBe(true);
    expect(coordinator.skip(session('skipped'))).toBe(false);
    controller.abort();
    fake.setConnected(true);
    expect(await run).toBe('skipped');
    expect(coordinator.getSnapshot(session('skipped'))).toEqual({
      lifecycle: 'terminal',
      reason: 'skipped',
    });
    expect(fake.ackCalls).toEqual([]);
    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
  });

  it('does not rewrite presented or suppressed terminal proof with Skip and resets it for a new session', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    const context = (sessionId: SessionId) => ({
      sessionId,
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: new AbortController().signal,
      emitTranscript: () => {},
    });
    await coordinator.run(context(session('presented')));
    expect(coordinator.skip(session('presented'))).toBe(false);
    fake.setAck('deduped');
    await coordinator.run(context(session('suppressed')));
    expect(coordinator.skip(session('suppressed'))).toBe(false);
    expect(coordinator.skip(session('fresh'))).toBe(true);
    expect(coordinator.getSnapshot(session('fresh'))).toEqual({
      lifecycle: 'terminal',
      reason: 'skipped',
    });
  });

  it('keeps the inserted history but skips before caption when Skip wins after acknowledgement', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    fake.setAck(async () => {
      coordinator.skip(session('after-ack'));
      return 'inserted';
    });
    const captions: string[] = [];

    expect(
      await coordinator.run({
        sessionId: session('after-ack'),
        text: 'Hello',
        instance: fake.instance,
        adapter: adapter.adapter,
        signal: new AbortController().signal,
        emitTranscript: (text) => captions.push(text),
      }),
    ).toBe('skipped');
    expect(fake.ackCalls).toHaveLength(1);
    expect(captions).toEqual([]);
    expect(adapter.speakCalls).toEqual([]);
  });

  it('skips an active provider handoff without allowing a later completion to rewrite proof', async () => {
    const coordinator = new GreetingCoordinator();
    const fake = makeFakeInstance();
    const adapter = makeFakeAdapter();
    let release!: (result: GreetingSpeechResult) => void;
    adapter.setSpeak(
      () =>
        new Promise<GreetingSpeechResult>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new AbortController();
    const run = coordinator.run({
      sessionId: session('active-speech'),
      text: 'Hello',
      instance: fake.instance,
      adapter: adapter.adapter,
      signal: controller.signal,
      emitTranscript: () => {},
    });
    await flushTasks();
    expect(adapter.speakCalls).toHaveLength(1);

    expect(coordinator.skip(session('active-speech'))).toBe(true);
    controller.abort();
    release('accepted');
    expect(await run).toBe('skipped');
    expect(coordinator.getSnapshot(session('active-speech'))).toEqual({
      lifecycle: 'terminal',
      reason: 'skipped',
    });
  });

  describe('lifecycle dispositions and snapshots', () => {
    function lifecycle(coordinator: GreetingCoordinator, id: SessionId) {
      return coordinator.getSnapshot(id);
    }

    it('returns accepted, then already_terminal, and exposes terminal proof synchronously', async () => {
      const coordinator = new GreetingCoordinator();
      const fake = makeFakeInstance();
      const adapter = makeFakeAdapter();
      const sessionId = session('terminal');
      const context = {
        sessionId,
        text: 'Hello',
        instance: fake.instance,
        adapter: adapter.adapter,
        signal: new AbortController().signal,
        emitTranscript: () => {},
      };

      expect(lifecycle(coordinator, sessionId)).toEqual({
        lifecycle: 'pending',
      });
      expect(await coordinator.run(context)).toBe('accepted');
      expect(lifecycle(coordinator, sessionId)).toEqual({
        lifecycle: 'terminal',
        reason: 'presented',
      });
      expect(await coordinator.run(context)).toBe('already_terminal');
    });

    it('classifies suppressed, not_started, failed, and current abort without inventing terminal proof', async () => {
      const cases = [
        {
          name: 'suppressed',
          configure: (fake: FakeInstance, _adapter: FakeAdapter) =>
            fake.setAck('deduped'),
          expected: 'suppressed',
          lifecycle: 'terminal',
          reason: 'suppressed',
        },
        {
          name: 'not-started',
          configure: (_fake: FakeInstance, adapter: FakeAdapter) =>
            adapter.setSpeak('not_started'),
          expected: 'not_started',
          lifecycle: 'pending',
          reason: undefined,
        },
        {
          name: 'failed',
          configure: (fake: FakeInstance, _adapter: FakeAdapter) =>
            fake.setAck(new Error('engine failed')),
          expected: 'failed',
          lifecycle: 'pending',
          reason: undefined,
        },
      ] as const;

      for (const testCase of cases) {
        const coordinator = new GreetingCoordinator();
        const fake = makeFakeInstance();
        const adapter = makeFakeAdapter();
        const sessionId = session(testCase.name);
        testCase.configure(fake, adapter);
        const result = await coordinator.run({
          sessionId,
          text: 'Hello',
          instance: fake.instance,
          adapter: adapter.adapter,
          signal: new AbortController().signal,
          emitTranscript: () => {},
        });
        expect(result).toBe(testCase.expected);
        expect(lifecycle(coordinator, sessionId)).toEqual(
          testCase.lifecycle === 'terminal'
            ? { lifecycle: 'terminal', reason: testCase.reason }
            : { lifecycle: 'pending' },
        );
      }

      const coordinator = new GreetingCoordinator();
      const fake = makeFakeInstance(false);
      const adapter = makeFakeAdapter();
      const controller = new AbortController();
      const sessionId = session('aborted');
      const run = coordinator.run({
        sessionId,
        text: 'Hello',
        instance: fake.instance,
        adapter: adapter.adapter,
        signal: controller.signal,
        emitTranscript: () => {},
      });
      controller.abort();
      expect(await run).toBe('aborted');
      expect(lifecycle(coordinator, sessionId)).toEqual({
        lifecycle: 'pending',
      });
    });

    it('returns stale when a superseded continuation resumes without changing the adopted snapshot', async () => {
      const coordinator = new GreetingCoordinator();
      const fake = makeFakeInstance();
      const adapter = makeFakeAdapter();
      const release = fake.gateAck();
      const runA = coordinator.run({
        sessionId: session('stale-a'),
        text: 'A',
        instance: fake.instance,
        adapter: adapter.adapter,
        signal: new AbortController().signal,
        emitTranscript: () => {},
      });
      await flushTasks();
      const runB = coordinator.run({
        sessionId: session('stale-b'),
        text: 'B',
        instance: fake.instance,
        adapter: adapter.adapter,
        signal: new AbortController().signal,
        emitTranscript: () => {},
      });
      release();

      expect(await runA).toBe('stale');
      expect(await runB).toBe('accepted');
      expect(lifecycle(coordinator, session('stale-b'))).toEqual({
        lifecycle: 'terminal',
        reason: 'presented',
      });
    });
  });
});
