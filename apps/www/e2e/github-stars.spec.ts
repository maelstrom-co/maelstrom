import { expect, test } from '@playwright/test';

const repositoryApi = 'https://api.github.com/repos/maelstrom-co/maelstrom';

test('refreshes an existing page count from GitHub without another deployment', async ({
  page,
}) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  let nextCount = 0;
  await page.route(repositoryApi, async (route) => {
    requests.push(route.request().method());
    expect(route.request().headers()).not.toHaveProperty('authorization');
    expect(route.request().headers()).not.toHaveProperty('x-request-id');
    expect(route.request().headers()).not.toHaveProperty('referer');
    await pending;
    await route.fulfill({
      json: { stargazers_count: nextCount },
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.goto('/');
  const count = page.locator('[data-github-star-count]');
  await expect.poll(() => requests.length).toBe(1);
  const previous = await count.textContent();
  nextCount = Number((previous || '0').replaceAll(',', '')) + 1;
  release();
  await expect(count).toHaveText(nextCount.toLocaleString('en-US'));
  await expect(count).toBeVisible();
  expect(requests).toEqual(['GET']);
});

test('keeps the build count when GitHub is unavailable', async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const unavailable = page.waitForEvent('console', {
    predicate: (message) =>
      message.text().includes('"event":"github_stars_unavailable"') &&
      message.text().includes('"status":403'),
  });
  await page.route(repositoryApi, async (route) => {
    await pending;
    await route.fulfill({
      status: 403,
      body: 'rate limited',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.goto('/');
  const count = page.locator('[data-github-star-count]');
  const fallback = await count.textContent();
  expect(fallback).toMatch(/^\d[\d,]*$/);
  release();
  await unavailable;
  await expect(count).toHaveText(fallback!);
  await expect(
    page.getByRole('link', { name: /Star on GitHub/ }),
  ).toBeVisible();
});

test('shows zero stars without inventing a positive count', async ({
  page,
}) => {
  await page.route(repositoryApi, (route) =>
    route.fulfill({
      json: { stargazers_count: 0 },
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await page.goto('/');
  await expect(page.locator('[data-github-star-count]')).toHaveText('0');
  await expect(page.locator('[data-github-star-count]')).toBeVisible();
});

test('reveals a fresh count when the build had no GitHub metadata', async ({
  page,
  baseURL,
}) => {
  await page.route(new URL('/', baseURL).href, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const placeholder = /<span\b[^>]*data-github-star-count[^>]*>[^<]*<\/span>/;
    expect(html).toMatch(placeholder);
    await route.fulfill({
      response,
      body: html.replace(
        placeholder,
        '<span class="star-count" data-github-star-count hidden></span>',
      ),
    });
  });
  await page.route(repositoryApi, (route) =>
    route.fulfill({
      json: { stargazers_count: 12 },
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
  await page.goto('/');
  await expect(page.locator('[data-github-star-count]')).toHaveText('12');
  await expect(page.locator('[data-github-star-count]')).toBeVisible();
});
