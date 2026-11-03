import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { ConnectorEvent, EngineConnector } from '@maelstrom-co/client';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMaelstrom } from './create-maelstrom.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function controlledConnector() {
  const handlers = new Set<(event: ConnectorEvent) => void>();
  const pendingDisconnects: Array<ReturnType<typeof deferred>> = [];
  let connected = false;
  const connect = mock(async () => {
    connected = true;
  });
  const connector: EngineConnector = {
    capabilities: { voice: false, streaming: false, stateful: true },
    connect,
    async disconnect() {
      const gate = deferred();
      pendingDisconnects.push(gate);
      await gate.promise;
      connected = false;
      for (const handler of handlers) {
        handler({ type: 'disconnected', clean: true, message: 'closed' });
      }
    },
    async process() {
      throw new Error('Lifecycle tests must not call the engine.');
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async addAssistantMessage() {},
    async getHistory() {
      return [];
    },
  };
  return {
    connector,
    connect,
    pendingDisconnects,
    get connected() {
      return connected;
    },
  };
}

const connectors: Array<ReturnType<typeof controlledConnector>> = [];

function createConnector() {
  const result = controlledConnector();
  connectors.push(result);
  return result;
}

afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const connector of connectors.splice(0)) {
      for (const gate of connector.pendingDisconnects) gate.resolve();
    }
  });
});

describe('Provider connection lifetime', () => {
  it('waits for Strict Mode teardown before connecting the replacement to the same transport', async () => {
    const transport = createConnector();
    const m = createMaelstrom({ vessels: [] });
    function Status() {
      return <output>{m.useMaelstrom().connectionStatus}</output>;
    }
    const view = render(
      <StrictMode>
        <m.Provider connector={transport.connector}>
          <Status />
        </m.Provider>
      </StrictMode>,
    );

    await waitFor(() => expect(transport.pendingDisconnects).toHaveLength(1));
    expect(transport.connect).not.toHaveBeenCalled();

    await act(async () => transport.pendingDisconnects[0]?.resolve());

    await waitFor(() =>
      expect(view.getByRole('status').textContent).toBe('connected'),
    );
    expect(transport.connected).toBe(true);
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });

  it('connects the latest connector prop after the teardown barrier', async () => {
    const previous = createConnector();
    const next = createConnector();
    const m = createMaelstrom({ vessels: [] });
    function Status() {
      return <output>{m.useMaelstrom().connectionStatus}</output>;
    }
    const view = render(
      <StrictMode>
        <m.Provider connector={previous.connector}>
          <Status />
        </m.Provider>
      </StrictMode>,
    );
    await waitFor(() => expect(previous.pendingDisconnects).toHaveLength(1));

    view.rerender(
      <StrictMode>
        <m.Provider connector={next.connector}>
          <Status />
        </m.Provider>
      </StrictMode>,
    );
    expect(next.connect).not.toHaveBeenCalled();
    await act(async () => {
      for (const gate of previous.pendingDisconnects) gate.resolve();
    });

    await waitFor(() =>
      expect(view.getByRole('status').textContent).toBe('connected'),
    );
    expect(previous.connect).not.toHaveBeenCalled();
    expect(next.connect).toHaveBeenCalledTimes(1);
    expect(next.connected).toBe(true);
  });

  it('does not block an independent provider behind another provider teardown', async () => {
    const slow = createConnector();
    const independent = createConnector();
    const first = createMaelstrom({ vessels: [] });
    const second = createMaelstrom({ vessels: [] });
    render(
      <StrictMode>
        <first.Provider connector={slow.connector}>
          <div />
        </first.Provider>
      </StrictMode>,
    );
    await waitFor(() => expect(slow.pendingDisconnects).toHaveLength(1));

    render(
      <second.Provider connector={independent.connector}>
        <div />
      </second.Provider>,
    );
    await waitFor(() => expect(independent.connect).toHaveBeenCalledTimes(1));
    expect(independent.connected).toBe(true);
    expect(slow.connect).not.toHaveBeenCalled();
  });

  it('cancels a replacement startup when it unmounts during the old teardown', async () => {
    const transport = createConnector();
    const onError = mock();
    const m = createMaelstrom({ vessels: [] });
    const view = render(
      <StrictMode>
        <m.Provider connector={transport.connector} onError={onError}>
          <div />
        </m.Provider>
      </StrictMode>,
    );
    await waitFor(() => expect(transport.pendingDisconnects).toHaveLength(1));
    view.unmount();
    await act(async () => {
      for (const gate of transport.pendingDisconnects) gate.resolve();
    });

    expect(transport.connect).not.toHaveBeenCalled();
    expect(transport.connected).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
});
