import { afterEach, expect, mock, test } from 'bun:test';
import { SessionId } from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';
import { flushMicrotasks } from '../../../test-utils/async-utils.js';
import { ConnectionManager } from './connection-manager.js';
import type { ConnectionOptions } from './connection-manager.types.js';
import type { ConnectorEvent, EngineConnector } from './connector.types.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function controlledConnector() {
  const shutdowns: Array<ReturnType<typeof deferred>> = [];
  const handlers = new Set<(event: ConnectorEvent) => void>();
  const connect = mock(async () => {});
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: true },
    connect,
    async disconnect() {
      const gate = deferred();
      shutdowns.push(gate);
      await gate.promise;
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    async process() {
      throw new Error('Connection lifecycle tests make no planning requests.');
    },
    async addAssistantMessage() {},
    async getHistory() {
      return [];
    },
  };
  return {
    connector,
    connect,
    shutdowns,
    emit(event: ConnectorEvent) {
      for (const handler of handlers) handler(event);
    },
  };
}

const managers: ConnectionManager[] = [];
const connectorFixtures: Array<ReturnType<typeof controlledConnector>> = [];
function setup(options: Partial<ConnectionOptions> = {}) {
  const x = controlledConnector();
  const y = controlledConnector();
  connectorFixtures.push(x, y);
  const manager = new ConnectionManager(x.connector, {
    sessionId: SessionId('reuse-test'),
    maxRetries: 1,
    ...options,
  });
  managers.push(manager);
  return { x, y, manager };
}
afterEach(async () => {
  const disposing = managers.splice(0).map((manager) => manager.dispose());
  for (const item of connectorFixtures.splice(0))
    for (const gate of item.shutdowns) gate.resolve();
  await Promise.all(disposing);
});

test('only the current binding dials after a waiting X binding is replaced by Y and X again', async () => {
  const { x, y, manager } = setup();
  manager.setConnector(y.connector);
  manager.setConnector(x.connector);
  const firstAttempt = manager.connect();
  manager.setConnector(y.connector);
  manager.setConnector(x.connector);
  expect(x.connect).not.toHaveBeenCalled();

  for (const gate of x.shutdowns) gate.resolve();
  await firstAttempt;
  await flushMicrotasks();
  expect(x.connect).toHaveBeenCalledTimes(1);
  expect(y.connect).not.toHaveBeenCalled();
  expect(manager.store.state.connectionStatus).toBe('connected');
});

test('disposal waits for outgoing connector shutdowns as well as the current connector', async () => {
  const { x, y, manager } = setup();
  manager.setConnector(y.connector);
  let settled = false;
  const disposing = manager.dispose().then(() => {
    settled = true;
  });
  y.shutdowns[0]?.resolve();
  await flushMicrotasks();
  expect(settled).toBe(false);

  x.shutdowns[0]?.resolve();
  await disposing;
  expect(settled).toBe(true);
});

test('overlapping shutdowns retain the oldest pending close when a newer close rejects', async () => {
  const { x, y, manager } = setup();
  manager.setConnector(y.connector);
  manager.setConnector(x.connector);
  manager.setConnector(y.connector);
  manager.setConnector(x.connector);
  const connecting = manager.connect();
  x.shutdowns[1]?.reject(new Error('Newer shutdown failed'));
  await flushMicrotasks();
  expect(x.connect).not.toHaveBeenCalled();

  x.shutdowns[0]?.resolve();
  await connecting;
  expect(x.connect).toHaveBeenCalledTimes(1);
  expect(manager.store.state.connectionStatus).toBe('connected');
});

test('disposal cancels a connection waiting for its reused connector to close', async () => {
  const { x, y, manager } = setup();
  manager.setConnector(y.connector);
  manager.setConnector(x.connector);
  const connecting = manager.connect();
  const disposing = manager.dispose();
  for (const item of [x, y]) for (const gate of item.shutdowns) gate.resolve();
  await Promise.all([connecting, disposing]);

  expect(x.connect).not.toHaveBeenCalled();
  expect(manager.store.state.connectionStatus).toBe('disconnected');
});

test('a late failure from an earlier X binding cannot poison a replacement X connection', async () => {
  const { x, y, manager } = setup();
  const firstDial = deferred();
  x.connect.mockImplementationOnce(() => firstDial.promise);
  const connecting = manager.connect();
  manager.setConnector(y.connector);
  manager.setConnector(x.connector);
  x.shutdowns[0]?.resolve();
  await flushMicrotasks();
  expect(manager.store.state.connectionStatus).toBe('connected');

  firstDial.reject(new Error('Retired X failed'));
  await connecting;
  expect(manager.store.state.connectionStatus).toBe('connected');
  expect(manager.store.state.connectionError).toBeNull();
  expect(manager.store.state.circuitBreakerStatus).toBe('closed');
});

test('a half-open probe waits for its reused connector shutdown', async () => {
  const clock = FakeTimers.install();
  try {
    const { x, y, manager } = setup({ circuitBreakerTimeoutMs: 5 });
    x.connect.mockRejectedValueOnce(new Error('Initial connection failed'));
    await expect(manager.connect()).rejects.toThrow(
      'Initial connection failed',
    );
    manager.setConnector(y.connector);
    manager.setConnector(x.connector);
    await clock.tickAsync(5);
    expect(x.connect).toHaveBeenCalledTimes(1);

    x.shutdowns[0]?.resolve();
    await flushMicrotasks();
    expect(x.connect).toHaveBeenCalledTimes(2);
    expect(manager.store.state.connectionStatus).toBe('connected');
    expect(manager.store.state.circuitBreakerStatus).toBe('closed');
  } finally {
    clock.uninstall();
  }
});

test('an error callback can replace X with Y and X without the old attempt opening its breaker', async () => {
  const { x, y, manager } = setup();
  x.connect.mockRejectedValueOnce(new Error('Old binding failed'));
  const unsubscribe = manager.events.on('connection_error', () => {
    unsubscribe();
    manager.setConnector(y.connector);
    manager.setConnector(x.connector);
  });
  await manager.connect().catch(() => undefined);
  expect(manager.store.state.circuitBreakerStatus).toBe('closed');
  expect(manager.store.state.connectionError).toBeNull();

  x.shutdowns[0]?.resolve();
  await flushMicrotasks();
  expect(manager.store.state.connectionStatus).toBe('connected');
});

test('a circuit-open callback can replace the connector without losing its recovery timer', async () => {
  const clock = FakeTimers.install();
  try {
    const { x, y, manager } = setup({ circuitBreakerTimeoutMs: 5 });
    x.connect.mockRejectedValueOnce(new Error('Engine unavailable'));
    const unsubscribe = manager.events.on('circuit_opened', () => {
      unsubscribe();
      manager.setConnector(y.connector);
    });
    await manager.connect().catch(() => undefined);
    await clock.tickAsync(5);
    expect(y.connect).toHaveBeenCalledTimes(1);
    expect(manager.store.state.connectionStatus).toBe('connected');
    expect(manager.store.state.circuitBreakerStatus).toBe('closed');
  } finally {
    clock.uninstall();
  }
});

test('a half-open error callback cannot overwrite a replacement binding status', async () => {
  const clock = FakeTimers.install();
  try {
    const { x, y, manager } = setup({ circuitBreakerTimeoutMs: 5 });
    x.connect
      .mockRejectedValueOnce(new Error('Initial failure'))
      .mockRejectedValueOnce(new Error('Probe failure'));
    await manager.connect().catch(() => undefined);
    const unsubscribe = manager.events.on('connection_error', () => {
      unsubscribe();
      manager.setConnector(y.connector);
      manager.setConnector(x.connector);
    });
    await clock.tickAsync(5);
    expect(manager.store.state.connectionStatus).toBe('connecting');
    x.shutdowns[0]?.resolve();
    await flushMicrotasks();
    expect(manager.store.state.connectionStatus).toBe('connected');
  } finally {
    clock.uninstall();
  }
});

test('a failed half-open probe preserves recovery after a circuit-open callback replaces its connector', async () => {
  const clock = FakeTimers.install();
  try {
    const { x, y, manager } = setup({ circuitBreakerTimeoutMs: 5 });
    x.connect
      .mockRejectedValueOnce(new Error('Initial failure'))
      .mockRejectedValueOnce(new Error('Probe failure'));
    await manager.connect().catch(() => undefined);
    const unsubscribe = manager.events.on('circuit_opened', () => {
      unsubscribe();
      manager.setConnector(y.connector);
    });
    await clock.tickAsync(10);
    expect(y.connect).toHaveBeenCalledTimes(1);
    expect(manager.store.state.connectionStatus).toBe('connected');
  } finally {
    clock.uninstall();
  }
});

test('a retired success cannot reset a replacement retry count before it becomes stable', async () => {
  const clock = FakeTimers.install();
  try {
    const { x, y, manager } = setup({
      maxRetries: 2,
      initialDelayMs: 1,
      maxDelayMs: 1,
      stabilityThresholdMs: 5,
    });
    x.connect.mockRejectedValueOnce(new Error('First attempt failed'));
    const unsubscribe = manager.events.on('circuit_closed', () => {
      unsubscribe();
      manager.setConnector(y.connector);
      manager.setConnector(x.connector);
    });
    const connecting = manager.connect();
    await clock.tickAsync(1);
    await connecting;
    await clock.tickAsync(5);
    expect(manager.store.state.connectionRetryCount).toBe(1);
    x.shutdowns[0]?.resolve();
    await flushMicrotasks();
    await clock.tickAsync(5);
    expect(manager.store.state.connectionRetryCount).toBe(0);
  } finally {
    clock.uninstall();
  }
});

test.each([
  'initial',
  'probe',
  'automatic',
] as const)('a store observer replacing an open breaker preserves recovery after %s failure', async (phase) => {
  const clock = FakeTimers.install();
  try {
    const { x, y, manager } = setup({
      circuitBreakerTimeoutMs: 5,
      initialDelayMs: 1,
      maxDelayMs: 1,
    });
    if (phase === 'probe') {
      x.connect.mockRejectedValueOnce(new Error('Initial failure'));
      await manager.connect().catch(() => undefined);
    } else if (phase === 'automatic') await manager.connect();
    const subscription = manager.store.subscribe(() => {
      if (manager.store.state.circuitBreakerStatus !== 'open') return;
      subscription.unsubscribe();
      manager.setConnector(y.connector);
    });
    x.connect.mockRejectedValueOnce(
      new Error('Failure before store replacement'),
    );
    if (phase === 'initial') await manager.connect().catch(() => undefined);
    if (phase === 'automatic')
      x.emit({
        type: 'disconnected',
        clean: false,
        message: 'Connection lost',
      });
    await clock.tickAsync(phase === 'probe' ? 10 : 6);
    expect(y.connect).toHaveBeenCalledTimes(1);
    expect(manager.store.state.circuitBreakerStatus).toBe('closed');
    subscription.unsubscribe();
  } finally {
    clock.uninstall();
  }
});

test('a store observer replacing a connected binding cannot receive a stale connected event', async () => {
  const { x, y, manager } = setup();
  const events: string[] = [];
  const stop = manager.events.on('connection_status_changed', ({ status }) =>
    events.push(status),
  );
  const subscription = manager.store.subscribe(() => {
    if (manager.store.state.connectionStatus !== 'connected') return;
    subscription.unsubscribe();
    manager.setConnector(y.connector);
    manager.setConnector(x.connector);
  });
  await manager.connect();
  expect(manager.store.state.connectionStatus).toBe('connecting');
  expect(events).not.toContain('connected');
  x.shutdowns[0]?.resolve();
  await flushMicrotasks();
  expect(events.filter((status) => status === 'connected')).toHaveLength(1);
  stop();
  subscription.unsubscribe();
});
