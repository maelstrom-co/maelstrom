import { test as base, expect } from '@playwright/test';
import { guardE2ENetwork } from './network-guard';

/** UI smoke tests deny unmocked external HTTP and WebSocket traffic. */
export const test = base.extend<{ networkGuard: undefined }>({
  serviceWorkers: 'block',
  networkGuard: [
    async ({ context }, use) => {
      const blocked = await guardE2ENetwork(context);
      await use(undefined);
      expect(blocked, 'Unmocked external E2E traffic').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
