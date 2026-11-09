import { expect, test } from 'bun:test';

import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';

test.each(['memory', 'durable'])(
  'storage copy follows confirmed %s storage and clears after reset',
  async (storage) => {
    const server = await createServer({
      configFile: `${import.meta.dirname}/../vite.config.ts`,
      server: { port: 0, host: '127.0.0.1', open: false },
    });
    try {
      await server.listen();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        page.setDefaultTimeout(3000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/workspace/bootstrap', (route) =>
          route.fulfill({
            json: {
              needsReconciliation: true,
              records: { revision: 0, journal: [], tasks: [], calendar: [] },
              operations: [],
              storage,
            },
          }),
        );
        await page.route('**/api/workspace/reset', (route) =>
          route.fulfill({ json: {} }),
        );
        await page.goto(server.resolvedUrls!.local[0]);
        const durable = page.getByText('Hosted workspaces retain records', {
          exact: false,
        });
        const memory = page.getByText('This local build stores records', {
          exact: false,
        });
        await browserExpect(
          page.getByText('Open your workspace'),
        ).toBeVisible();
        await browserExpect(durable).toHaveCount(0);
        await browserExpect(memory).toHaveCount(0);
        await page.getByLabel('OpenAI API key').fill('sk-test-only-key');
        await page.getByRole('button', { name: 'Open workspace' }).click();
        await browserExpect(
          page.getByText('Inspect before continuing'),
        ).toBeVisible();
        await browserExpect(
          storage === 'durable' ? durable : memory,
        ).toBeVisible();
        await browserExpect(
          storage === 'durable' ? memory : durable,
        ).toHaveCount(0);
        await page.getByRole('button', { name: 'Reset workspace' }).click();
        await browserExpect(
          page.getByText('Open your workspace'),
        ).toBeVisible();
        await browserExpect(durable).toHaveCount(0);
        await browserExpect(memory).toHaveCount(0);
        expect(errors).toEqual([]);
        if (process.env.UI_ARTIFACT_DIR) {
          await page.screenshot({
            path: `${process.env.UI_ARTIFACT_DIR}/447-${storage}.png`,
          });
        }
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  },
  30_000,
);
