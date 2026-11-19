import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { act, cleanup, render } from '@testing-library/react';

import { createMockConnector } from './__tests__/mock-connector.js';
import { createMaelstrom } from './create-maelstrom.js';

afterEach(cleanup);

describe('Provider Action runner timeout', () => {
  it('refuses timer overflow instead of silently skipping a lazy runner', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const connector = createMockConnector();
    const connect = spyOn(connector, 'connect');
    try {
      const onError = mock();
      const m = createMaelstrom({ vessels: [] });
      const view = render(
        <m.Provider
          connector={connector}
          readyTimeoutMs={2_147_483_648}
          onError={onError}
        >
          <div>ready</div>
        </m.Provider>,
      );
      await act(async () => {});
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0].message).toContain('2147483647');
      expect(view.container.textContent).toBe('');
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
      consoleError.mockRestore();
    }
  });

  it.each([0, 2_147_483_647])(
    'accepts the timer boundary %s',
    async (readyTimeoutMs) => {
      const onError = mock();
      const m = createMaelstrom({ vessels: [] });
      const view = render(
        <m.Provider
          connector={createMockConnector()}
          readyTimeoutMs={readyTimeoutMs}
          onError={onError}
        >
          <div>ready</div>
        </m.Provider>,
      );
      await act(async () => {});
      expect(onError).not.toHaveBeenCalled();
      expect(view.container.textContent).toBe('ready');
    },
  );
});
