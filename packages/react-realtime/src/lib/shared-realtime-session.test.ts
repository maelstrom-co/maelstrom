import { expect, test } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';
import type {
  GreetingCoordinator,
  RealtimeSession,
  RealtimeSessionMemory,
} from '@maelstrom-co/realtime';
import {
  type SharedRealtimeSessionBuild,
  SharedRealtimeSessionRegistry,
} from './shared-realtime-session.js';

const flush = async () =>
  await new Promise<void>((resolve) => queueMicrotask(resolve));

type Factory = (
  coordinator: GreetingCoordinator,
  memory: RealtimeSessionMemory,
  provider: string,
) => RealtimeSession;

/** Registry whose next build uses the factory of the latest getOrCreate call. */
function createRegistry(initialProvider = 'first') {
  let factory: Factory = () => {
    throw new Error('no factory');
  };
  const registry = new SharedRealtimeSessionRegistry<string>({
    initialProvider: () => initialProvider,
    build: ({ coordinator, memory, provider }) => ({
      session: factory(coordinator, memory, provider),
    }),
  });
  return Object.assign(registry, {
    getOrCreate(orchestrator: never, next: Factory) {
      factory = next;
      return registry.read(orchestrator).entry;
    },
  });
}

interface FakeSession {
  readonly provider: string;
  connects: number;
  disconnects: number;
  disconnect(): Promise<void>;
  connect(): Promise<void>;
}

function switchingSetup() {
  const orchestrator = { getConfig: () => ({ sessionId: 'session' }) } as never;
  const built: FakeSession[] = [];
  const released: string[] = [];
  let disconnectGate: Promise<void> | undefined;
  let failBuild: Error | undefined;
  const registry = new SharedRealtimeSessionRegistry<string>({
    initialProvider: () => 'live',
    build: ({ provider, memory, coordinator }): SharedRealtimeSessionBuild => {
      if (failBuild) throw failBuild;
      const session: FakeSession & {
        memory: RealtimeSessionMemory;
        coordinator: GreetingCoordinator;
      } = {
        provider,
        memory,
        coordinator,
        connects: 0,
        disconnects: 0,
        connect: async () => {
          session.connects += 1;
        },
        disconnect: async () => {
          session.disconnects += 1;
          if (disconnectGate) await disconnectGate;
        },
      };
      built.push(session);
      return {
        session: session as never,
        release: () => released.push(provider),
      };
    },
  });
  return {
    registry,
    orchestrator,
    built,
    released,
    gateDisconnect: () => {
      let open!: () => void;
      disconnectGate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        disconnectGate = undefined;
        open();
      };
    },
    failBuild: (error: Error | undefined) => {
      failBuild = error;
    },
  };
}

test('switches after disconnecting, keeps memory and coordinator, then releases the old wiring', async () => {
  const state = switchingSetup();
  const first = state.registry.read(state.orchestrator);
  const retain = state.registry.retain(state.orchestrator, first.entry);
  const notified: boolean[] = [];
  state.registry.subscribe(state.orchestrator, () =>
    notified.push(state.registry.read(state.orchestrator).switching),
  );
  const open = state.gateDisconnect();
  const switching = state.registry.switchProvider(
    state.orchestrator,
    'realtime',
  );
  expect(state.registry.read(state.orchestrator).switching).toBe(true);
  await flush();
  expect(state.built).toHaveLength(1);
  expect(state.released).toEqual([]);
  open();
  await switching;
  const next = state.registry.read(state.orchestrator);
  expect(next.provider).toBe('realtime');
  expect(next.switching).toBe(false);
  expect(next.entry).not.toBe(first.entry);
  expect(state.built.map((session) => session.provider)).toEqual([
    'live',
    'realtime',
  ]);
  expect(state.built[0]?.disconnects).toBe(1);
  expect(state.released).toEqual(['live']);
  const [old, replacement] = state.built as unknown as Array<{
    memory: unknown;
    coordinator: unknown;
  }>;
  expect(replacement?.memory).toBe(old?.memory);
  expect(replacement?.coordinator).toBe(old?.coordinator);
  expect(notified).toEqual([true, false]);
  retain();
  await flush();
  expect(state.released).toEqual(['live']);
});

test('refuses connect while switching and shares a pending switch to the same provider', async () => {
  const state = switchingSetup();
  state.registry.read(state.orchestrator);
  const open = state.gateDisconnect();
  const first = state.registry.switchProvider(state.orchestrator, 'realtime');
  expect(state.registry.switchProvider(state.orchestrator, 'realtime')).toBe(
    first,
  );
  await state.registry.connect(state.orchestrator);
  expect(state.built[0]?.connects).toBe(0);
  open();
  await first;
  await state.registry.connect(state.orchestrator);
  expect(state.built[1]?.connects).toBe(1);
  await expect(
    state.registry.switchProvider(state.orchestrator, 'realtime'),
  ).resolves.toBeUndefined();
  expect(state.built).toHaveLength(2);
});

test('a switch requested while the old session starts disconnecting shares the pending promise', async () => {
  const state = switchingSetup();
  const current = state.registry.read(state.orchestrator).entry
    .session as unknown as FakeSession;
  let nested: Promise<void> | undefined;
  let switchingSeen: boolean | undefined;
  const disconnect = current.disconnect;
  current.disconnect = () => {
    switchingSeen = state.registry.read(state.orchestrator).switching;
    nested = state.registry.switchProvider(state.orchestrator, 'realtime');
    return disconnect();
  };
  const switching = state.registry.switchProvider(
    state.orchestrator,
    'realtime',
  );
  expect(nested).toBe(switching);
  expect(switchingSeen).toBe(true);
  await switching;
  expect(state.built).toHaveLength(2);
});

test('drops a superseded switch and builds only the latest provider', async () => {
  const state = switchingSetup();
  state.registry.read(state.orchestrator);
  const open = state.gateDisconnect();
  const superseded = state.registry.switchProvider(
    state.orchestrator,
    'realtime',
  );
  const latest = state.registry.switchProvider(state.orchestrator, 'livekit');
  open();
  await Promise.all([superseded, latest]);
  expect(state.built.map((session) => session.provider)).toEqual([
    'live',
    'livekit',
  ]);
  expect(state.registry.read(state.orchestrator).provider).toBe('livekit');
});

test('keeps the current session when building the replacement throws', async () => {
  const state = switchingSetup();
  const before = state.registry.read(state.orchestrator);
  state.failBuild(new Error('fixture build failure'));
  await expect(
    state.registry.switchProvider(state.orchestrator, 'realtime'),
  ).rejects.toThrow('fixture build failure');
  const after = state.registry.read(state.orchestrator);
  expect(after.entry).toBe(before.entry);
  expect(after.provider).toBe('live');
  expect(after.switching).toBe(false);
  expect(state.released).toEqual([]);
  state.failBuild(undefined);
  await state.registry.switchProvider(state.orchestrator, 'realtime');
  expect(state.registry.read(state.orchestrator).provider).toBe('realtime');
});

test('remembers the selected provider across retirement and releases wiring after disconnect', async () => {
  const state = switchingSetup();
  const first = state.registry.read(state.orchestrator);
  await state.registry.switchProvider(state.orchestrator, 'realtime');
  const second = state.registry.read(state.orchestrator);
  state.registry.retain(state.orchestrator, second.entry)();
  state.registry.retain(state.orchestrator, first.entry)();
  await flush();
  await flush();
  expect(state.released).toEqual(['live', 'realtime']);
  const remounted = state.registry.read(state.orchestrator);
  expect(remounted.entry).not.toBe(second.entry);
  expect(remounted.provider).toBe('realtime');
  expect(state.built.at(-1)?.provider).toBe('realtime');
});

test('only remembers a switch requested while no session is live', async () => {
  const state = switchingSetup();
  const first = state.registry.read(state.orchestrator);
  state.registry.retain(state.orchestrator, first.entry)();
  await flush();
  await state.registry.switchProvider(state.orchestrator, 'livekit');
  expect(state.built).toHaveLength(1);
  expect(state.registry.read(state.orchestrator).provider).toBe('livekit');
  expect(state.built.at(-1)?.provider).toBe('livekit');
});

function setup() {
  const registry = createRegistry();
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
  const registry = createRegistry();
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
  const registry = createRegistry();
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
  const registry = createRegistry();
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
  const registry = createRegistry();
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
  const registry = createRegistry();
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
