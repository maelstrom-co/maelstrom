import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { Orchestrator } from '@maelstrom-co/client';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';

function pendingStartup() {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

afterEach(cleanup);

describe('Provider startup error ownership', () => {
  it('reports an active startup failure to the latest error callback', async () => {
    const startup = pendingStartup();
    const connect = spyOn(Orchestrator.prototype, 'connect').mockImplementation(
      () => startup.promise,
    );
    try {
      const connector = createMockConnector();
      const firstOnError = mock();
      const currentOnError = mock();
      const m = createMaelstrom({ vessels: [] });
      const view = render(
        <m.Provider connector={connector} onError={firstOnError}>
          <div />
        </m.Provider>,
      );
      await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
      view.rerender(
        <m.Provider connector={connector} onError={currentOnError}>
          <div />
        </m.Provider>,
      );
      const error = new Error('Current startup failed');
      await act(async () => startup.reject(error));

      expect(firstOnError).not.toHaveBeenCalled();
      expect(currentOnError).toHaveBeenCalledTimes(1);
      expect(currentOnError).toHaveBeenCalledWith(error);
    } finally {
      connect.mockRestore();
    }
  });

  it('does not deliver a late startup failure after its Provider retires', async () => {
    const startup = pendingStartup();
    const connect = spyOn(Orchestrator.prototype, 'connect').mockImplementation(
      () => startup.promise,
    );
    try {
      const connector = createMockConnector();
      const onError = mock();
      const m = createMaelstrom({ vessels: [] });
      const view = render(
        <m.Provider connector={connector} onError={onError}>
          <div />
        </m.Provider>,
      );
      await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
      view.unmount();
      await act(async () =>
        startup.reject(new Error('Retired startup failed')),
      );

      expect(onError).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
    }
  });
});
