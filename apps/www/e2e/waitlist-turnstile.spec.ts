import { expect, test } from '@playwright/test';

test('waitlist executes Turnstile on submit and continues without a second click', async ({
  page,
}) => {
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          const state = window.__turnstileTest = {
            executeCount: 0,
            renderCount: 0,
            resetCount: 0,
          };
          let options;
          window.turnstile = {
            render(container, nextOptions) {
              state.renderCount += 1;
              options = nextOptions;
              container.dataset.turnstileReady = 'true';
              return 'waitlist-widget';
            },
            execute() {
              state.executeCount += 1;
              queueMicrotask(() => options.callback('smart-turnstile-token'));
            },
            reset() {
              state.resetCount += 1;
            },
            remove() {},
          };
        `,
      }),
  );

  let requestBody: unknown;
  await page.route('**/api/waitlist', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto('/#waitlist');
  await page.locator('#waitlist').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-turnstile-ready="true"]')).toBeAttached();

  expect(
    await page.evaluate(() => Reflect.get(window, '__turnstileTest')),
  ).toMatchObject({ executeCount: 0, renderCount: 1 });

  await page.getByPlaceholder('you@example.com').fill('user@example.com');
  await page.getByRole('button', { name: 'Join the Beta' }).click();

  await expect(
    page.getByText('Check your inbox to confirm your place.'),
  ).toBeVisible();
  expect(requestBody).toEqual({
    email: 'user@example.com',
    turnstileToken: 'smart-turnstile-token',
  });
  expect(
    await page.evaluate(() => Reflect.get(window, '__turnstileTest')),
  ).toMatchObject({ executeCount: 1, renderCount: 1, resetCount: 1 });
});

test('waitlist fails promptly when Turnstile reports an unsupported browser', async ({
  page,
}) => {
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          window.turnstile = {
            render(container, options) {
              container.dataset.turnstileReady = 'true';
              queueMicrotask(() => options['unsupported-callback']());
              return 'unsupported-widget';
            },
            execute() { throw new Error('execute must not run'); },
            reset() {},
            remove() {},
          };
        `,
      }),
  );

  let submitted = false;
  await page.route('**/api/waitlist', async (route) => {
    submitted = true;
    await route.abort();
  });

  await page.goto('/#waitlist');
  await page.locator('#waitlist').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-turnstile-ready="true"]')).toBeAttached();
  await page.getByPlaceholder('you@example.com').fill('user@example.com');
  await page.getByRole('button', { name: 'Join the Beta' }).click();

  await expect(page.getByRole('alert')).toContainText(
    'This browser cannot run the security check.',
  );
  expect(submitted).toBe(false);
});
