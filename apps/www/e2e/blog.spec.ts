import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { outputText, withBlogBuild } from './fixtures/blog/build';

for (const width of [1280, 375]) {
  for (const [index, name, slug] of [
    [0, 'Hello Maelstrom', 'hello-maelstrom'],
    [1, 'Another placeholder', 'another-placeholder'],
  ] as const) {
    test(`${slug} card hit areas and keyboard links work at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width, height: 800 });
      for (const area of [
        '.blog-card-cover',
        '.blog-card-description',
        'padding',
      ]) {
        await page.goto('/blog/');
        const card = page.locator('.blog-list > li').nth(index);
        const target = area === 'padding' ? card : card.locator(area);
        await target.evaluate((element, padding) => {
          const box = element.getBoundingClientRect();
          window.scrollBy({
            top:
              box.y + (padding ? 8 : box.height / 2) - window.innerHeight / 2,
            behavior: 'instant',
          });
        }, area === 'padding');
        const box = await target.boundingBox();
        if (!box) throw new Error(`Missing card ${area}`);
        await page.mouse.click(
          box.x + (area === 'padding' ? 8 : box.width / 2),
          box.y + (area === 'padding' ? 8 : box.height / 2),
        );
        await page.waitForURL(`/blog/${slug}/`, {
          waitUntil: 'domcontentloaded',
        });
        await expect(page).toHaveURL(new RegExp(`/blog/${slug}/$`));
        await expect(
          page.getByRole('heading', { name, exact: true }),
        ).toBeVisible();
      }

      await page.goto('/blog/');
      const card = page.locator('.blog-list > li').nth(index);
      const title = card.getByRole('link', {
        name,
        exact: true,
      });
      const author = card.getByRole('link', { name: 'Maelstrom', exact: true });
      await expect(card.getByRole('link')).toHaveCount(2);
      await expect(title).toHaveCSS('text-decoration-line', 'none');
      await title.hover();
      await expect(title).toHaveCSS('text-decoration-line', 'none');
      await expect(title).toHaveCSS('cursor', 'pointer');
      await title.focus();
      await page.keyboard.press('Tab');
      await expect(author).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(title).toBeFocused();
      await expect(title).toHaveCSS('text-decoration-line', 'none');
      await expect(card).toHaveCSS('outline-style', 'solid');
      await expect(card).toHaveCSS('outline-width', '2px');
      await page.keyboard.press('Enter');
      await page.waitForURL(`/blog/${slug}/`, {
        waitUntil: 'domcontentloaded',
      });
      await expect(page).toHaveURL(new RegExp(`/blog/${slug}/$`));
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible();
      if (slug === 'another-placeholder') {
        await expect(
          page.getByText('boilerplate second entry', { exact: true }),
        ).toBeVisible();
      }

      await page.goto('/blog/');
      await expect(author).toHaveAttribute('href', 'https://maelstrom-ai.co');
      await page.route('https://maelstrom-ai.co/', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<h1>Author site</h1>',
        }),
      );
      await author.click();
      await expect(page).toHaveURL('https://maelstrom-ai.co/');
    });
  }

  test(`main navigation opens the first blog post at ${width}px`, async ({
    page,
  }) => {
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
    const stories = page.locator('.blog-list > li');
    await expect(stories).toHaveCount(2);
    await expect(stories.getByRole('heading', { level: 2 })).toHaveText([
      'Hello Maelstrom',
      'Another placeholder',
    ]);
    for (const cover of await stories.locator('img').all()) {
      await expect(cover).toHaveAttribute('src', '/og.png');
      await expect(cover).toHaveJSProperty('complete', true);
      expect(
        await cover.evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBeGreaterThan(0);
    }
    const board = await page.locator('.blog-list').boundingBox();
    const feature = await stories.nth(0).boundingBox();
    const support = await stories.nth(1).boundingBox();
    expect(board).not.toBeNull();
    if (!board || !feature || !support) throw new Error('Missing bento cards');
    if (width === 1280) {
      expect(feature.width).toBeGreaterThan(support.width);
      expect(support.x).toBeGreaterThanOrEqual(feature.x + feature.width);
      expect(support.y).toBeCloseTo(feature.y, 0);
    } else {
      expect(feature.width).toBeCloseTo(board.width, 0);
      expect(support.width).toBeCloseTo(board.width, 0);
      expect(support.y).toBeGreaterThanOrEqual(feature.y + feature.height);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('link', { name: 'Hello Maelstrom', exact: true })
      .click();
    await expect(page).toHaveURL(/\/blog\/hello-maelstrom\/$/);
    await expect(
      page.getByRole('heading', { name: 'Hello Maelstrom', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('boilerplate first entry', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Maelstrom', exact: true }),
    ).toHaveAttribute('href', 'https://maelstrom-ai.co');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://maelstrom-ai.co/blog/hello-maelstrom/',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('link', { name: '← All posts' }).click();
    await expect(page).toHaveURL(/\/blog\/$/);
  });
}

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
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      const cards = page.locator('.blog-list > li');
      for (const card of await cards.all()) {
        await card.scrollIntoViewIfNeeded();
        expect(
          await card.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + 8, box.y + 8);
            const outside = document.elementFromPoint(box.x - 8, box.y + 8);
            return (
              hit === element.querySelector('h2 a') &&
              !element.contains(outside)
            );
          }),
        ).toBe(true);
      }
      const feature = await cards.nth(0).boundingBox();
      const support = await cards.nth(1).boundingBox();
      expect(feature).not.toBeNull();
      expect(support).not.toBeNull();
      if (feature && support) {
        if (width === 1280) {
          expect(feature.width).toBeGreaterThan(support.width);
          expect(support.x).toBeGreaterThanOrEqual(feature.x + feature.width);
        } else {
          expect(support.y).toBeGreaterThanOrEqual(feature.y + feature.height);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  });
});
