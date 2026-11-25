import { afterAll, beforeAll, expect, test } from 'bun:test';

import {
  chromium,
  expect as browserExpect,
  type Browser,
} from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

import { LocalWorkspaceHost } from '../src/server/http-host';

let server: ViteDevServer;
let browser: Browser;
let url: string;
const records = { revision: 0, journal: [], tasks: [], calendar: [] };
const review = {
  needsReconciliation: true,
  records,
  operations: [],
  storage: 'memory',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  server = await createServer({
    configFile: `${import.meta.dirname}/../vite.config.ts`,
    server: { port: 0, host: '127.0.0.1', open: false },
  });
  try {
    await server.listen();
    url = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    await server.close();
    throw error;
  }
}, 30_000);

afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
});

test('discloses generated speech before the user starts GPT-Live', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/api/workspace/bootstrap', (route) =>
      route.fulfill({
        json: {
          needsReconciliation: false,
          records,
          bindingId: 'voice-binding',
          sessionId: 'voice-session',
          threadId: 'voice-thread',
          storage: 'memory',
        },
      }),
    );
    await page.goto(url);
    await page.getByLabel('OpenAI API key').fill('sk-test-only-key');
    await page.getByRole('button', { name: 'Open workspace' }).click();
    const panel = page.getByRole('region', { name: 'GPT-Live voice' });
    await browserExpect(
      panel.getByRole('button', { name: 'Start GPT-Live' }),
    ).toBeVisible();
    await browserExpect(
      panel.getByText('AI-generated voice', { exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
  }
}, 20_000);

test.each(['session', 'review', 'error'])(
  'bootstrap %s settles before reset or another bootstrap can start',
  async (outcome) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const pending = deferred();
    const reset = deferred();
    let opens = 0;
    let resets = 0;
    const bootstrapCookies: string[] = [];
    const resetCookies: string[] = [];
    try {
      await page.route('**/api/workspace/bootstrap', async (route) => {
        opens++;
        bootstrapCookies.push(route.request().headers().cookie ?? '');
        if (opens === 2) {
          await pending.promise;
          return route.fulfill({
            status: outcome === 'error' ? 503 : 200,
            headers:
              outcome === 'error'
                ? { 'x-workspace-recovery': 'error-proof' }
                : {
                    'x-workspace-recovery': 'review-proof',
                    'Set-Cookie':
                      'agui_local_route=synthetic-old; Path=/; HttpOnly; SameSite=Strict',
                  },
            json:
              outcome === 'session'
                ? {
                    needsReconciliation: false,
                    records,
                    bindingId: 'current-binding',
                    sessionId: 'current-session',
                    threadId: 'current-thread',
                    storage: 'memory',
                  }
                : review,
          });
        }
        return route.fulfill({
          json: review,
          headers: {
            'x-workspace-recovery': 'initial-proof',
            'Set-Cookie': `agui_local_route=${opens === 1 ? 'synthetic-old' : 'synthetic-new'}; Path=/; HttpOnly; SameSite=Strict`,
          },
        });
      });
      await page.route('**/api/workspace/reset', async (route) => {
        resets++;
        resetCookies.push(route.request().headers().cookie ?? '');
        const headers = new Headers(route.request().headers());
        expect(headers.get('x-workspace-binding')).toBe(
          outcome === 'session' ? 'current-binding' : null,
        );
        expect(headers.get('x-workspace-recovery')).toBe(
          outcome === 'session' ? null : `${outcome}-proof`,
        );
        await reset.promise;
        await route.fulfill({
          json: {},
          headers: {
            'Set-Cookie': 'agui_local_route=; Path=/; HttpOnly; Max-Age=0',
          },
        });
      });
      await page.route('**/api/workspace/exchange', (route) =>
        route.fulfill({
          status: 409,
          json: { error: { code: 'BINDING_RETIRED' } },
        }),
      );
      await page.goto(url);
      await page.getByLabel('OpenAI API key').fill('sk-test-only-key');
      await page.getByRole('button', { name: 'Open workspace' }).click();
      await browserExpect(
        page.getByRole('button', { name: 'Reconcile and continue' }),
      ).toBeEnabled();
      // All three events run before React can commit the first busy state.
      await page.evaluate(() => {
        const form = document.querySelector('form')!;
        const reset = [...document.querySelectorAll('button')].find(
          (button) => button.textContent === 'Reset workspace',
        )!;
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        );
        reset.click();
      });
      await browserExpect.poll(() => opens).toBe(2);
      await browserExpect(
        page.getByRole('button', { name: 'Reset workspace' }),
      ).toBeDisabled();
      await browserExpect(
        page.getByRole('button', { name: 'Opening…' }),
      ).toBeDisabled();
      await page
        .getByRole('button', { name: 'Reset workspace' })
        .dispatchEvent('click');
      await page.getByLabel('OpenAI API key').press('Enter');
      expect(opens).toBe(2);
      expect(resets).toBe(0);
      pending.resolve();
      await browserExpect(
        page.getByRole('button', { name: 'Reset workspace' }),
      ).toBeEnabled();
      if (outcome === 'session') {
        await browserExpect(
          page.getByRole('button', { name: 'Inspect and reconcile' }),
        ).toBeVisible();
      } else if (outcome === 'error') {
        await browserExpect(page.getByRole('alert')).toContainText(
          'could not be opened',
        );
      } else {
        await browserExpect(
          page.getByRole('button', { name: 'Reconcile and continue' }),
        ).toBeEnabled();
      }
      // Exercise reset admission and a conflicting open in the same event turn.
      await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')];
        const reset = buttons.find(
          (button) => button.textContent === 'Reset workspace',
        )!;
        reset.click();
        reset.click();
        const form = document.querySelector('.setup-panel form');
        if (form)
          form.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          );
        else
          buttons
            .find((button) => button.textContent === 'Inspect and reconcile')!
            .click();
      });
      await browserExpect.poll(() => resets).toBe(1);
      await browserExpect(
        page.getByRole('button', { name: 'Reset workspace' }),
      ).toBeDisabled();
      if (outcome !== 'session') {
        await browserExpect(
          page.getByRole('button', { name: 'Reconcile and continue' }),
        ).toBeDisabled();
        await page.getByLabel('OpenAI API key').press('Enter');
      }
      expect(opens).toBe(2);
      reset.resolve();
      await browserExpect(page.getByText('Open your workspace')).toBeVisible();
      await browserExpect(page.locator('.workspace-chart')).toHaveCount(0);
      await browserExpect(page.locator('pre')).toHaveCount(0);
      await browserExpect(page.getByRole('alert')).toHaveCount(0);
      await browserExpect(
        page.getByRole('button', { name: 'Open workspace' }),
      ).toBeEnabled();
      if (process.env.UI_ARTIFACT_DIR) {
        await page.screenshot({
          path: `${process.env.UI_ARTIFACT_DIR}/445-${outcome}.png`,
        });
      }
      await page.getByRole('button', { name: 'Open workspace' }).click();
      await browserExpect(
        page.getByText('Inspect before continuing'),
      ).toBeVisible();
      expect(opens).toBe(3);
      expect(resets).toBe(1);
      expect(resetCookies).toEqual(['agui_local_route=synthetic-old']);
      expect(bootstrapCookies).toEqual([
        '',
        'agui_local_route=synthetic-old',
        '',
      ]);
      expect(errors).toEqual([]);
    } finally {
      pending.resolve();
      reset.resolve();
      await page.close();
    }
  },
  20_000,
);

test('a stale tab must inspect again before it can reset a shared workspace', async () => {
  const context = await browser.newContext();
  const origin = new URL(url).origin;
  const host = new LocalWorkspaceHost(origin);
  try {
    await context.route('**/api/workspace/*', async (route) => {
      const req = route.request();
      if (new URL(req.url()).pathname === '/api/workspace/exchange')
        return route.fulfill({ status: 409, json: {} });
      const response = await host.fetch(
        new Request(req.url(), {
          headers: await req.allHeaders(),
          method: req.method(),
          body: req.postData(),
        }),
      );
      return route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    const pages = [await context.newPage(), await context.newPage()];
    for (const page of pages) {
      await page.goto(url);
      await page.getByLabel('OpenAI API key').fill('sk-test-only-key');
      await page.getByRole('button', { name: 'Open workspace' }).click();
      if (page === pages[1])
        await page
          .getByRole('button', { name: 'Reconcile and continue' })
          .click();
      await browserExpect(page.locator('.workspace-chart')).toBeVisible();
    }
    await pages[0].getByRole('button', { name: 'Reset workspace' }).click();
    await browserExpect(pages[0].getByRole('alert')).toContainText(
      'inspect the workspace again',
    );
    await browserExpect(
      pages[0].getByRole('button', { name: 'Reset workspace' }),
    ).toHaveCount(0);
    await pages[1].getByRole('button', { name: 'Reset workspace' }).click();
    await browserExpect(
      pages[1].getByText('Open your workspace'),
    ).toBeVisible();
    expect(
      (await context.cookies()).filter(
        ({ name }) => name === 'agui_local_workspace',
      ),
    ).toEqual([]);
  } finally {
    await context.close();
  }
}, 20_000);

test.each(['http', 'network'])(
  'a reset %s failure releases admission for a successful retry',
  async (failure) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    let resets = 0;
    try {
      await page.route('**/api/workspace/bootstrap', (route) =>
        route.fulfill({
          json: review,
          headers: { 'x-workspace-recovery': 'review-proof' },
        }),
      );
      await page.route('**/api/workspace/reset', (route) => {
        resets++;
        if (resets === 1) {
          return failure === 'http'
            ? route.fulfill({ status: 503, json: {} })
            : route.abort('failed');
        }
        return route.fulfill({ json: {} });
      });
      await page.goto(url);
      await page.getByLabel('OpenAI API key').fill('sk-test-only-key');
      await page.getByRole('button', { name: 'Open workspace' }).click();
      const reset = page.getByRole('button', { name: 'Reset workspace' });
      await reset.click();
      await browserExpect(page.getByRole('alert')).toContainText(
        'Workspace reset failed.',
      );
      await browserExpect(
        page.getByRole('button', { name: 'Reconcile and continue' }),
      ).toBeEnabled();
      await browserExpect(reset).toBeEnabled();
      await reset.click();
      await browserExpect(page.getByRole('alert')).toHaveCount(0);
      await browserExpect(page.locator('pre')).toHaveCount(0);
      await browserExpect(
        page.getByRole('button', { name: 'Open workspace' }),
      ).toBeEnabled();
      expect(resets).toBe(2);
    } finally {
      await page.close();
    }
  },
  20_000,
);
