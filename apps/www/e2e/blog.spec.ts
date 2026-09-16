import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  addExtraPost,
  outputText,
  sourcePosts,
  withBlogBuild,
} from './fixtures/blog/build';

const posts = await sourcePosts();

for (const width of [1280, 375]) {
  for (const [index, post] of posts.entries()) {
    const {
      id: slug,
      data: { title: name, author: authorName, authorUrl },
    } = post;
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
      const author = card.getByRole('link', { name: authorName, exact: true });
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
      await page.goto('/blog/');
      await expect(author).toHaveAttribute('href', authorUrl);
      await page.route(new URL(authorUrl).href, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<h1>Author site</h1>',
        }),
      );
      await author.click();
      await expect(page).toHaveURL(new URL(authorUrl).href);
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
    await expect(stories).toHaveCount(posts.length);
    await expect(stories.getByRole('heading', { level: 2 })).toHaveText(
      posts.map((post) => post.data.title),
    );
    for (const [index, post] of posts.entries()) {
      const cover = stories.nth(index).locator('img');
      await cover.scrollIntoViewIfNeeded();
      await expect(cover).toHaveAttribute('src', post.data.image);
      await expect(stories.nth(index).locator('h2 a')).toHaveAttribute(
        'href',
        `/blog/${post.id}/`,
      );
      await expect(cover).toHaveJSProperty('complete', true);
      expect(
        await cover.evaluate((image: HTMLImageElement) => image.naturalWidth),
      ).toBeGreaterThan(0);
    }
    const first = posts[0];
    if (!first) {
      await expect(
        page.getByText('No posts yet.', { exact: false }),
      ).toBeVisible();
      return;
    }
    const board = await page.locator('.blog-list').boundingBox();
    const feature = await stories.nth(0).boundingBox();
    const support =
      posts.length > 1 ? await stories.nth(1).boundingBox() : null;
    expect(board).not.toBeNull();
    if (!board || !feature) throw new Error('Missing bento cards');
    if (!support) {
      expect(feature.width).toBeCloseTo(board.width, 0);
    } else if (width === 1280) {
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
      .getByRole('link', { name: first.data.title, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/blog/${first.id}/$`));
    await expect(
      page.getByRole('heading', { name: first.data.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: first.data.author, exact: true }),
    ).toHaveAttribute('href', first.data.authorUrl);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      `https://maelstrom-ai.co/blog/${first.id}/`,
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
    '/blog/fixture-missing-post/',
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
      const labels = page.getByRole('list', { name: 'Labels' });
      await expect(labels).toHaveCSS('list-style-type', 'none');
      await expect(labels).toHaveCSS('display', 'flex');
      await expect(labels).toHaveCSS('padding-left', '0px');
      for (const [tag, marker, items] of [
        ['ul', 'disc', ['First unordered item', 'Second unordered item']],
        ['ol', 'decimal', ['First ordered item', 'Second ordered item']],
      ] as const) {
        const list = page.locator(`.blog-prose ${tag}`);
        await expect(list).toHaveCSS('list-style-type', marker);
        await expect(list.locator('li')).toHaveText([...items]);
        for (const item of await list.locator('li').all()) {
          await expect(item).toBeVisible();
          await expect(item).toHaveCSS('display', 'list-item');
          await expect(item).toHaveCSS('list-style-type', marker);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole('link', { name: '← All posts' }).click();
    await expect(page.locator('.blog-list')).toHaveCSS(
      'list-style-type',
      'none',
    );
    await expect(page.locator('.blog-list > li')).toHaveCount(3);
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

test('an extra source post adapts card count, order, routes, titles and image expectations', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await withBlogBuild(async ({ root, output, build }) => {
    await addExtraPost(root);
    const expected = await sourcePosts(root);
    expect(expected).toHaveLength(posts.length + 1);
    build();
    const files = new Map([['/blog/', 'blog/index.html']]);
    for (const post of expected) {
      files.set(`/blog/${post.id}/`, `blog/${post.id}/index.html`);
      if (post.data.image.startsWith('/'))
        files.set(post.data.image, post.data.image.slice(1));
    }
    await page.route('https://preview.example/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = files.get(path);
      if (file) await route.fulfill({ path: join(output, file) });
      else if (/^\/_astro\/[a-zA-Z0-9_.-]+$/.test(path))
        await route.fulfill({ path: join(output, path.slice(1)) });
      else await route.abort();
    });
    await page.goto('https://preview.example/blog/');
    const cards = page.locator('.blog-list > li');
    await expect(cards).toHaveCount(expected.length);
    await expect(cards.locator('h2')).toHaveText(
      expected.map((post) => post.data.title),
    );
    for (const [index, post] of expected.entries()) {
      const card = cards.nth(index);
      await expect(card.locator('h2 a')).toHaveAttribute(
        'href',
        `/blog/${post.id}/`,
      );
      const image = card.locator('img');
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveAttribute('src', post.data.image);
      await expect(image).toHaveJSProperty('complete', true);
      expect(
        await image.evaluate(
          (element: HTMLImageElement) => element.naturalWidth,
        ),
      ).toBeGreaterThan(0);
    }
    await expect(
      page.locator('img[src="/fixture-extra.svg"]'),
    ).toHaveJSProperty('naturalWidth', 40);
    for (const post of expected) {
      await page.goto(`https://preview.example/blog/${post.id}/`);
      await expect(page.locator('h1')).toHaveText(post.data.title);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        'content',
        new URL(post.data.image, 'https://maelstrom-ai.co').href,
      );
    }
  });
});

test('an initially empty glob watches additions, changes, deletion and recovery', async ({
  request,
  page,
}) => {
  test.setTimeout(180_000);
  await withBlogBuild(async ({ root, withDev }) => {
    const content = join(root, 'src/content/blog');
    await rm(content, { recursive: true });
    await mkdir(content);
    await writeFile(join(content, 'README.md'), 'Not a post');
    await withDev(async (origin) => {
      const index = async () => (await request.get(`${origin}/blog/`)).text();
      await expect.poll(index).toContain('No posts yet.');
      await addExtraPost(root);
      await expect
        .poll(index, { timeout: 30_000 })
        .toContain('Fictional extra publication');
      const path = join(content, 'fixture-extra.mdx');
      const source = await readFile(path, 'utf8');
      await writeFile(
        path,
        source.replace(
          'Fictional extra publication',
          'Fictional watched change',
        ),
      );
      await expect
        .poll(index, { timeout: 30_000 })
        .toContain('Fictional watched change');
      await rm(path);
      await expect.poll(index, { timeout: 30_000 }).toContain('No posts yet.');
      await writeFile(path, source);
      await expect
        .poll(index, { timeout: 30_000 })
        .toContain('Fictional extra publication');
      expect(
        (await request.get(`${origin}/blog/fixture-extra/`)).status(),
      ).toBe(200);
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${origin}/blog/`);
        const stories = page.locator('.blog-list > li');
        await expect(stories).toHaveCount(1);
        const board = await page.locator('.blog-list').boundingBox();
        const feature = await stories.first().boundingBox();
        if (!board || !feature) throw new Error('Missing singleton card');
        expect(feature.width).toBeCloseTo(board.width, 0);
        await stories.locator('h2 a').click();
        await expect(page).toHaveURL(`${origin}/blog/fixture-extra/`);
      }
    });
  });
});
