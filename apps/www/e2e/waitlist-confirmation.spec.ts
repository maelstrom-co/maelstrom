import { expect, test } from '@playwright/test';
import { installPostHogRecorder } from './posthog';

const RESULT_PAGES = [
  `/waitlist/confirm/#token=v1.${'a'.repeat(43)}`,
  '/waitlist/confirmed/',
  '/waitlist/invalid/',
];

const readPaintOrder = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const shell = document.querySelector('.result-shell');
    const shader = document.querySelector('#mae-shader');
    return {
      shell:
        Number.parseInt(shell ? getComputedStyle(shell).zIndex : '0', 10) || 0,
      shader:
        Number.parseInt(shader ? getComputedStyle(shader).zIndex : '0', 10) ||
        0,
    };
  });

for (const path of RESULT_PAGES) {
  test(`waitlist result content paints above the shader on ${path}`, async ({
    page,
  }) => {
    await page.goto(path);

    const shell = page.locator('.result-shell');
    const card = page.locator('.result-card');
    await expect(shell).toBeVisible();
    await expect(card.getByRole('heading')).toBeVisible();
    await expect(shell).toHaveCSS('position', 'relative');
    await expect(shell).toHaveCSS('z-index', '2');
    await expect(card).toHaveCSS('border-top-style', 'solid');
    await expect(card).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const paintOrder = await readPaintOrder(page);
    expect(paintOrder.shell).toBeGreaterThan(paintOrder.shader);
  });
}

test('confirmation content remains visible without overflow on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/waitlist/confirm/#token=v1.${'a'.repeat(43)}`);

  await expect(
    page.getByRole('heading', { name: 'Confirm your email' }),
  ).toBeVisible();
  const paintOrder = await readPaintOrder(page);
  expect(paintOrder.shell).toBeGreaterThan(paintOrder.shader);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

const RECEIPT = `v1.${'b'.repeat(43)}`;

test('hides the Discord invitation from visitors without a receipt', async ({
  page,
}) => {
  const captures = await installPostHogRecorder(page);
  await page.goto('/waitlist/confirmed/');

  await expect(
    page.getByRole('heading', { name: 'This access link has expired' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Join the beta Discord' }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Resend invitation' }),
  ).toBeVisible();
  expect(captures).toEqual([]);
});

test('expired recovery keeps accepted and failed feedback generic and private', async ({
  page,
}) => {
  const email = 'confirmed@example.com';
  const token = 'resend-turnstile-token';
  const captures = await installPostHogRecorder(page);
  const consoleMessages: string[] = [];
  const requestUrls: string[] = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  page.on('request', (request) => requestUrls.push(request.url()));
  await page.route(
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `
          let options;
          window.turnstile = {
            render(container, nextOptions) {
              options = nextOptions;
              container.dataset.turnstileReady = 'true';
              return 'resend-widget';
            },
            execute() { queueMicrotask(() => options.callback('${token}')); },
            reset() {},
            remove() {},
          };
        `,
      }),
  );

  const resendRequests: import('@playwright/test').Request[] = [];
  await page.route('**/api/waitlist/resend', async (route) => {
    resendRequests.push(route.request());
    await route.fulfill({
      status: resendRequests.length === 1 ? 202 : 500,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex',
      },
      json: { success: true },
    });
  });

  const cookiesBefore = await page.context().cookies();
  for (const expectedStatus of [202, 500]) {
    const response = await page.goto('/waitlist/confirmed/');
    expect(response?.headers()['cache-control']).toBe('no-store');
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['x-robots-tag']).toBe('noindex');
    await expect(page.locator('[data-turnstile-ready="true"]')).toBeAttached();
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('button', { name: 'Resend invitation' }).click();

    await expect(
      page.getByText(
        'If an invitation can be sent, check your inbox. If it does not arrive, try again in a few minutes.',
      ),
    ).toBeVisible();
    await expect(page.getByLabel('Email address')).toHaveCount(0);
    expect((await resendRequests.at(-1)?.response())?.status()).toBe(
      expectedStatus,
    );
  }

  for (const resendRequest of resendRequests) {
    expect(resendRequest.method()).toBe('POST');
    expect(resendRequest.headers().origin).toBe(new URL(page.url()).origin);
    expect(resendRequest.headers()['content-type']).toContain(
      'application/json',
    );
    expect(resendRequest.postDataJSON()).toEqual({
      email,
      turnstileToken: token,
    });
  }
  expect(
    requestUrls.every((url) => !url.includes(email) && !url.includes(token)),
  ).toBe(true);
  expect(await page.context().cookies()).toEqual(cookiesBefore);
  expect(await page.locator('body').textContent()).not.toContain(email);
  expect(await page.locator('body').textContent()).not.toContain(token);
  expect(consoleMessages.join('\n')).not.toContain(email);
  expect(consoleMessages.join('\n')).not.toContain(token);
  expect(captures).toEqual([]);
});

test('confirmed subscribers reach Discord through the confirmation flow', async ({
  page,
}) => {
  const captures = await installPostHogRecorder(page);
  await page.route('**/api/waitlist/confirm', async (route) => {
    await route.fulfill({
      status: 303,
      // Mirror the production cookie contract so the redirect lands gated-in.
      headers: {
        Location: '/waitlist/confirmed/',
        'Set-Cookie': `waitlist_receipt=${RECEIPT}; Path=/waitlist/confirmed; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
      },
    });
  });

  await page.goto(`/waitlist/confirm/#token=${RECEIPT}`);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page).toHaveURL(/\/waitlist\/confirmed\/$/);

  const discordInvite = page.getByRole('link', {
    name: 'Join the beta Discord',
  });
  await expect(discordInvite).toBeVisible();
  await expect(discordInvite).toHaveAttribute(
    'href',
    'https://discord.gg/XAjJqrF2u3',
  );
  await expect(page.getByLabel('Email address')).toHaveCount(0);
  await expect
    .poll(() => captures)
    .toContainEqual({
      event: 'waitlist_confirmation_page_viewed',
      properties: undefined,
    });

  await discordInvite.evaluate((element) => {
    element.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    });
    (element as HTMLElement).click();
  });
  await expect
    .poll(() => captures)
    .toContainEqual({
      event: 'waitlist_discord_invite_clicked',
      properties: { source: 'confirmed_page' },
    });
});

test('confirmation keeps its bearer token out of requests and telemetry', async ({
  page,
}) => {
  const token = `v1.${'a'.repeat(43)}`;
  const requests: import('@playwright/test').Request[] = [];
  let confirmationRequest: import('@playwright/test').Request | undefined;
  page.on('request', (request) => {
    requests.push(request);
  });
  await page.route('**/api/waitlist/confirm', async (route) => {
    confirmationRequest = route.request();
    await route.fulfill({
      status: 303,
      // Mirror the production cookie contract; without the receipt the
      // redirect would land on the gated-out view.
      headers: {
        Location: '/waitlist/confirmed/',
        'Set-Cookie': `waitlist_receipt=${RECEIPT}; Path=/waitlist/confirmed; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
      },
    });
  });

  const response = await page.goto(`/waitlist/confirm/#token=${token}`);

  expect(requests.map((request) => request.url())).not.toContainEqual(
    expect.stringContaining(token),
  );
  expect(response?.headers()['cache-control']).toBe('no-store');
  expect(response?.headers()['x-robots-tag']).toBe('noindex');
  expect(await response?.text()).not.toContain(token);
  await expect(page).toHaveURL(/\/waitlist\/confirm\/$/);
  await expect(page.locator('input[name="token"]')).toHaveValue(token);
  expect(await page.locator('script').allTextContents()).not.toContainEqual(
    expect.stringContaining('posthog.init'),
  );

  await page.getByRole('button', { name: 'Confirm my email' }).click();

  await expect(page).toHaveURL(/\/waitlist\/confirmed\/$/);
  await expect(
    page.getByRole('link', { name: 'Join the beta Discord' }),
  ).toBeVisible();

  expect(confirmationRequest?.method()).toBe('POST');
  expect(confirmationRequest?.url()).not.toContain(token);
  // A `no-referrer` policy on the page makes browsers emit `Origin: null`
  // here, which production CSRF checking rejects. The Origin must be real.
  expect(confirmationRequest?.headers().origin).toBe(
    new URL(page.url()).origin,
  );
  expect(confirmationRequest?.headers()['content-type']).toContain(
    'application/x-www-form-urlencoded',
  );
  expect(
    new URLSearchParams(confirmationRequest?.postData() ?? '').get('token'),
  ).toBe(token);
  expect(requests.map((request) => request.url())).not.toContainEqual(
    expect.stringContaining(token),
  );
  expect(
    requests
      .filter((request) => request !== confirmationRequest)
      .every((request) => !request.postData()?.includes(token)),
  ).toBe(true);
});
