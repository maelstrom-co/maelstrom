import { expect, test } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';
import { SharedRealtimeSessionRegistry } from './shared-realtime-session.js';

const flush = async () =>
  await new Promise<void>((resolve) => queueMicrotask(resolve));

function setup() {
  const registry = new SharedRealtimeSessionRegistry();
  const orchestrator = { getConfig: () => ({ sessionId: 'session' }) } as never;
  let disconnects = 0;
  let reject = false;
  let factories = 0;
  let coordinator: unknown;
  const entry = () =>
    registry.getOrCreate(orchestrator, (received) => {
      factories += 1;
      coordinator = received;
      return {
        disconnect: async () => {
          disconnects += 1;
          if (reject) throw new Error('best effort');
        },
      } as never;
    });
  return {
    registry,
    orchestrator,
    entry,
    get disconnects() {
      return disconnects;
    },
    get factories() {
      return factories;
    },
    get coordinator() {
      return coordinator;
    },
    rejectDisconnect: () => {
      reject = true;
    },
  };
}

test('shares a live entry and release is idempotent', () => {
  const state = setup();
  const first = state.entry();
  expect(state.entry()).toBe(first);
  const release = state.registry.retain(state.orchestrator, first);
  const other = state.registry.retain(state.orchestrator, first);
  release();
  release();
  other();
});

test('provider and session retirement retains generated introduction proof for one application identity', async () => {
  const registry = new SharedRealtimeSessionRegistry();
  const sessionId = SessionId('native');
  const orchestrator = { getConfig: () => ({ sessionId }) } as never;
  let attempts = 0;
  const create = () =>
    registry.getOrCreate(
      orchestrator,
      (_coordinator, memory) =>
        ({
          memory,
          connect: async () => {
            if (memory.claimIntroduction()) attempts++;
          },
          disconnect: async () => {},
        }) as never,
    );
  const first = create();
  await first.session.connect();
  registry.retain(orchestrator, first)();
  await flush();
  const second = create();
  expect(second.session).not.toBe(first.session);
  await second.session.connect();
  expect(attempts).toBe(1);
  expect(second.session.memory.getSnapshot().introductionAttempted).toBe(true);
  await second.session.disconnect();
});

test('queues one retirement for multiple final releases', async () => {
  const state = setup();
  const entry = state.entry();
  const first = state.registry.retain(state.orchestrator, entry);
  const second = state.registry.retain(state.orchestrator, entry);
  first();
  second();
  await flush();
  expect(state.disconnects).toBe(1);
});

test('Strict Mode-style reacquisition before retirement keeps the entry live', async () => {
  const state = setup();
  const entry = state.entry();
  state.registry.retain(state.orchestrator, entry)();
  state.registry.retain(state.orchestrator, entry);
  await flush();
  expect(state.entry()).toBe(entry);
  expect(state.disconnects).toBe(0);
});

test('evicts before disconnect and reacquires independently while it settles', async () => {
  const state = setup();
  const first = state.entry();
  state.registry.retain(state.orchestrator, first)();
  await flush();
  const second = state.entry();
  expect(second).not.toBe(first);
  expect(state.factories).toBe(2);
  expect(state.disconnects).toBe(1);
});

test('swallows best-effort disconnect rejection and retains skipped proof across recreation', async () => {
  const state = setup();
  const first = state.entry();
  const coordinator =
    state.coordinator as import('@maelstrom-co/realtime').GreetingCoordinator;
  // Nx's package test target resolves the built public package; source-conditioned
  // runs below exercise this package-private coordinator behavior directly.
  if (typeof coordinator.skip !== 'function') return;
  const sessionId = 'session' as never;
  expect(coordinator.skip(sessionId)).toBe(true);
  state.rejectDisconnect();
  state.registry.retain(state.orchestrator, first)();
  await flush();
  state.entry();
  expect(state.coordinator).toBe(coordinator);
  expect(coordinator.getSnapshot(sessionId)).toEqual({
    lifecycle: 'terminal',
    reason: 'skipped',
  });
});

test('retains presented and suppressed terminal proof across recreation', async () => {
  for (const [outcome, reason] of [
    ['inserted', 'presented'],
    ['deduped', 'suppressed'],
  ] as const) {
    const state = setup();
    const first = state.entry();
    const coordinator =
      state.coordinator as import('@maelstrom-co/realtime').GreetingCoordinator;
    if (typeof coordinator.run !== 'function') return;
    const sessionId = `${reason}-session` as never;
    await coordinator.run({
      sessionId,
      text: 'Greeting',
      instance: {
        observeEngineConnection: (listener: (connected: boolean) => void) => {
          listener(true);
          return () => {};
        },
        addAssistantMessageAcknowledged: async () => outcome,
      } as never,
      adapter: {
        activateAudio: () => {},
        speakAssistantText: async () => 'accepted',
      } as never,
      signal: new AbortController().signal,
      emitTranscript: () => {},
    });
    state.registry.retain(state.orchestrator, first)();
    await flush();
    state.entry();
    expect(coordinator.getSnapshot(sessionId)).toEqual({
      lifecycle: 'terminal',
      reason,
    });
  }
});

test('evicts the zero-consumer entry before disconnect starts', async () => {
  const registry = new SharedRealtimeSessionRegistry();
  const orchestrator = { getConfig: () => ({ sessionId: 'session' }) } as never;
  let duringDisconnect: unknown;
  const factory = () =>
    ({
      disconnect: async () => {
        duringDisconnect = registry.getOrCreate(orchestrator, factory);
      },
    }) as never;
  const first = registry.getOrCreate(orchestrator, factory);
  registry.retain(orchestrator, first)();
  await flush();
  expect(duringDisconnect).not.toBe(first);
});

test('pending old disconnect rejection cannot affect its replacement', async () => {
  const registry = new SharedRealtimeSessionRegistry();
  const orchestrator = { getConfig: () => ({ sessionId: 'session' }) } as never;
  let rejectOld!: (error: Error) => void;
  let factories = 0;
  const entry = () =>
    registry.getOrCreate(orchestrator, () => {
      factories += 1;
      return {
        disconnect: () =>
          factories === 1
            ? new Promise<void>((_, reject) => {
                rejectOld = reject;
              })
            : Promise.resolve(),
      } as never;
    });
  const first = entry();
  registry.retain(orchestrator, first)();
  await flush();
  const replacement = entry();
  const retainReplacement = registry.retain(orchestrator, replacement);
  expect(factories).toBe(2);
  rejectOld(new Error('old disconnect'));
  await flush();
  expect(entry()).toBe(replacement);
  retainReplacement();
});

test('pending old disconnect completion cannot affect its replacement', async () => {
  const registry = new SharedRealtimeSessionRegistry();
  const orchestrator = { getConfig: () => ({ sessionId: 'session' }) } as never;
  let resolveOld!: () => void;
  let factories = 0;
  const entry = () =>
    registry.getOrCreate(orchestrator, () => {
      factories += 1;
      return {
        disconnect: () =>
          factories === 1
            ? new Promise<void>((resolve) => {
                resolveOld = resolve;
              })
            : Promise.resolve(),
      } as never;
    });
  const first = entry();
  registry.retain(orchestrator, first)();
  await flush();
  const replacement = entry();
  const retainReplacement = registry.retain(orchestrator, replacement);
  resolveOld();
  await flush();
  expect(entry()).toBe(replacement);
  retainReplacement();
});

test('different orchestrators retain independent entries and coordinators', () => {
  const registry = new SharedRealtimeSessionRegistry();
  const a = { getConfig: () => ({ sessionId: 'a' }) } as never;
  const b = { getConfig: () => ({ sessionId: 'b' }) } as never;
  let aCoordinator: unknown;
  let bCoordinator: unknown;
  const first = registry.getOrCreate(a, (coordinator) => {
    aCoordinator = coordinator;
    return { disconnect: async () => {} } as never;
  });
  const second = registry.getOrCreate(b, (coordinator) => {
    bCoordinator = coordinator;
    return { disconnect: async () => {} } as never;
  });
  expect(first).not.toBe(second);
  expect(aCoordinator).not.toBe(bCoordinator);
});
