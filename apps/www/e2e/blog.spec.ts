import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { outputText, withBlogBuild } from './fixtures/blog/build';

test('main navigation opens the empty blog on desktop and mobile', async ({
  page,
}) => {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    if (width === 375)
      await page.getByRole('button', { name: 'Open menu' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Blog', exact: true })
      .click();
    await expect(page).toHaveURL(/\/blog\/$/);
    await expect(
      page.getByRole('heading', { name: 'Blog', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('No posts yet.', { exact: false }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});

test('both index slash forms retain production canonical metadata; unknown posts return 404', async ({
  page,
}) => {
  for (const path of ['/blog', '/blog/']) {
    await page.goto(path);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://maelstrom-ai.co/blog/',
    );
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      'https://maelstrom-ai.co/blog/',
    );
  }
  for (const path of [
    '/blog/unknown-post/',
    '/blog/pages/',
    '/blog/fixture-alpha/',
  ]) {
    expect((await page.goto(path))?.status()).toBe(404);
  }
});

test('isolated built MDX renders post links and production metadata on either slash form', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await withBlogBuild(async ({ output, build, inject }) => {
    await inject();
    build();
    // Fulfil built HTML at preview URLs, not a development-rendered substitute.
    const html = await outputText(output, 'blog/fixture-alpha/index.html');
    await page.route('https://preview.example/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/blog/fixture-alpha' || path === '/blog/fixture-alpha/') {
        await route.fulfill({ contentType: 'text/html', body: html });
      } else if (path === '/blog/') {
        await route.fulfill({
          contentType: 'text/html',
          body: await outputText(output, 'blog/index.html'),
        });
      } else if (/^\/_astro\/[a-zA-Z0-9_.-]+$/.test(path)) {
        await route.fulfill({ path: join(output, path.slice(1)) });
      } else {
        await route.abort();
      }
    });
    for (const path of ['/blog/fixture-alpha', '/blog/fixture-alpha/']) {
      await page.setViewportSize({
        width: path.endsWith('/') ? 375 : 1280,
        height: 800,
      });
      await page.goto(`https://preview.example${path}`);
      await expect(
        page.getByRole('heading', { name: 'Fictional Alpha', exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId('mdx-expression')).toHaveText('42');
      await expect(
        page.getByRole('link', { name: 'Example Author', exact: true }),
      ).toHaveAttribute('href', 'https://example.com/author');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        'https://maelstrom-ai.co/blog/fixture-alpha/',
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        'content',
        'https://maelstrom-ai.co/blog/fixture-alpha/',
      );
      await expect(page.getByRole('list', { name: 'Labels' })).toHaveText(
        'engineeringMDX',
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole('link', { name: '← All posts' }).click();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Fictional Alpha',
      'Fictional Zeta',
      'Fictional Old',
    ]);
  });
});
