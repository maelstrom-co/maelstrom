import { expect, test } from 'bun:test';

import { chromium, expect as browserExpect } from '@playwright/test';
import { createServer } from 'vite';

test('an owner can reset after cold bootstrap fails before records can be reviewed', async () => {
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
      let resetAttempts = 0;
      await page.route('**/api/workspace/bootstrap', (route) =>
        route.fulfill({
          status: 503,
          json: { code: 'STORAGE_UNAVAILABLE' },
        }),
      );
      await page.route('**/api/workspace/reset', (route) => {
        resetAttempts++;
        expect(route.request().method()).toBe('POST');
        expect(route.request().headers()['x-openai-key']).toBeUndefined();
        return route.fulfill({
          status: resetAttempts === 1 ? 503 : 200,
          json: {},
        });
      });
      await page.goto(server.resolvedUrls!.local[0]);
      await page.getByLabel('OpenAI API key').fill('sk-test-only-key');
      await page.getByRole('button', { name: 'Open workspace' }).click();
      await browserExpect(page.getByRole('alert')).toContainText(
        'could not be opened',
      );
      const reset = page.getByRole('button', { name: 'Reset workspace' });
      await browserExpect(reset).toBeVisible();
      await reset.focus();
      await page.keyboard.press('Enter');
      await browserExpect(page.getByRole('alert')).toContainText(
        'Workspace reset failed.',
      );
      await browserExpect(reset).toBeEnabled();
      await reset.click();
      await browserExpect(page.getByRole('alert')).toHaveCount(0);
      await browserExpect(
        page.getByRole('button', { name: 'Open workspace' }),
      ).toBeEnabled();
      expect(resetAttempts).toBe(2);
      expect(errors).toEqual([]);
      if (process.env.UI_ARTIFACT_DIR) {
        await page.screenshot({
          path: `${process.env.UI_ARTIFACT_DIR}/446-reset.png`,
        });
      }
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}, 30_000);
