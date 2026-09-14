import { describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { outputText, withBlogBuild } from '../../e2e/fixtures/blog/build';
import {
  blogPath,
  blogSchema,
  blogSlug,
  productionUrl,
  sortPosts,
} from './blog';

const metadata = {
  title: 'Fixture title',
  description: 'Fixture description',
  date: '2026-01-02',
  image: '/og.png',
  labels: ' engineering, , MDX ',
  author: 'Example Author',
  authorUrl: 'https://example.com/author',
  keywords: ['engineering', 'MDX'],
};

describe('blog metadata', () => {
  test('normalizes labels and dates', () => {
    const data = blogSchema.parse(metadata);
    expect(data.labels).toEqual(['engineering', 'MDX']);
    expect(data.date.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  test.each(Object.keys(metadata))('requires %s', (key) => {
    const missing: Record<string, unknown> = { ...metadata };
    delete missing[key];
    expect(blogSchema.safeParse(missing).success).toBe(false);
  });

  test.each([
    { title: ' ' },
    { description: '' },
    { author: '\t' },
    { date: 'not a date' },
    { date: '2026-02-30' },
    { date: null },
    { date: 0 },
    { labels: ', , ' },
    { labels: ['engineering'] },
    { keywords: 'engineering' },
    { keywords: [''] },
    { image: '//evil.example/image.png' },
    { image: '/\\evil.example/image.png' },
    { image: '/images/../secret' },
    { image: '/%2e%2e/secret' },
    { image: 'javascript:alert(1)' },
    { image: 'data:image/png;base64,a' },
    { authorUrl: '/author' },
    { authorUrl: 'javascript:alert(1)' },
    { authorUrl: 'https://user:password@example.com' },
    { slug: 'override' },
  ])('rejects invalid frontmatter %j', (invalid) => {
    expect(blogSchema.safeParse({ ...metadata, ...invalid }).success).toBe(
      false,
    );
  });

  test.each([
    '/images/blog.png',
    'https://example.com/image.png',
    'http://example.com/image.png',
  ])('accepts image %s', (image) => {
    expect(blogSchema.safeParse({ ...metadata, image }).success).toBe(true);
  });
});

test('flat filenames are the only source of slugs', () => {
  expect(blogSlug('my-post.mdx')).toBe('my-post');
  for (const name of [
    'nested/post.mdx',
    'Upper.mdx',
    'a b.mdx',
    'a.b.mdx',
    'index.mdx',
    'pages.mdx',
    '-post.mdx',
    'a--b.mdx',
    'a%2fb.mdx',
    'post.md',
  ]) {
    expect(() => blogSlug(name)).toThrow();
  }
});

test('sorts newest first, then ASCII slug ascending without mutating input', () => {
  const entry = (id: string, date: string) => ({
    id,
    data: { date: new Date(date) },
  });
  const posts = [
    entry('z', '2026-01-02'),
    entry('old', '2025-01-01'),
    entry('a', '2026-01-02'),
  ];
  expect(sortPosts(posts).map((post) => post.id)).toEqual(['a', 'z', 'old']);
  expect(posts[0]?.id).toBe('z');
  expect(sortPosts([])).toEqual([]);
});

test('blog URLs always use the production origin and trailing slash', () => {
  expect(blogPath()).toBe('/blog/');
  expect(blogPath('my-post')).toBe('/blog/my-post/');
  expect(productionUrl(blogPath('my-post'))).toBe(
    'https://maelstrom-ai.co/blog/my-post/',
  );
  expect(productionUrl('/og.png')).toBe('https://maelstrom-ai.co/og.png');
  expect(productionUrl('https://example.com/image.png')).toBe(
    'https://example.com/image.png',
  );
});

test('actual collection builds production, isolated empty and fixture output', async () => {
  await withBlogBuild(async ({ output, build }) => {
    build();
    const productionIndex = await outputText(output, 'blog/index.html');
    expect(productionIndex).toContain('Hello Maelstrom');
    expect(productionIndex).toContain('Another placeholder');
    expect(productionIndex.indexOf('Hello Maelstrom')).toBeLessThan(
      productionIndex.indexOf('Another placeholder'),
    );
    expect(productionIndex).not.toContain('No posts yet.');
    expect((await readdir(join(output, 'blog'))).sort()).toEqual([
      'another-placeholder',
      'hello-maelstrom',
      'index.html',
    ]);
    const productionArticle = await outputText(
      output,
      'blog/hello-maelstrom/index.html',
    );
    expect(productionArticle).toContain(
      '<strong>boilerplate first entry</strong>',
    );
    expect(productionArticle).toContain('Lorem ipsum');
    expect(productionArticle).toContain(
      'rel="canonical" href="https://maelstrom-ai.co/blog/hello-maelstrom/"',
    );
    const productionSitemap = await outputText(output, 'sitemap-0.xml');
    const supportingArticle = await outputText(
      output,
      'blog/another-placeholder/index.html',
    );
    expect(supportingArticle).toContain(
      '<strong>boilerplate second entry</strong>',
    );
    expect(supportingArticle).toContain('Lorem ipsum');
    expect(supportingArticle).toContain(
      'rel="canonical" href="https://maelstrom-ai.co/blog/another-placeholder/"',
    );
    expect(productionSitemap).toContain(
      '<loc>https://maelstrom-ai.co/blog/another-placeholder/</loc>',
    );
    expect(productionSitemap).toContain(
      '<loc>https://maelstrom-ai.co/blog/hello-maelstrom/</loc>',
    );
    for (const text of [
      productionIndex,
      productionArticle,
      supportingArticle,
      productionSitemap,
    ]) {
      expect(text).not.toContain('fixture-');
      expect(text).not.toContain('Fictional');
      expect(text).not.toContain('Example Author');
      expect(text).not.toContain('/blog/pages');
    }
  });
  await withBlogBuild(async ({ root, output, build, inject }) => {
    const content = join(root, 'src/content/blog');
    await rm(content, { recursive: true });
    await mkdir(content);
    build();
    const emptyIndex = await outputText(output, 'blog/index.html');
    expect(emptyIndex).toContain('No posts yet.');
    expect(await readdir(join(output, 'blog'))).toEqual(['index.html']);
    const home = await outputText(output, 'index.html');
    expect(home).toContain('property="og:type" content="website"');
    expect(home).toContain(
      'property="og:image" content="https://maelstrom-ai.co/og.png"',
    );
    expect(home).toContain('rel="canonical" href="https://maelstrom-ai.co/"');
    expect(home).not.toContain('name="robots"');

    await inject();
    build();
    const index = await outputText(output, 'blog/index.html');
    expect(index.indexOf('Fictional Alpha')).toBeLessThan(
      index.indexOf('Fictional Zeta'),
    );
    expect(index.indexOf('Fictional Zeta')).toBeLessThan(
      index.indexOf('Fictional Old'),
    );
    expect(index).not.toContain('No posts yet.');
    const sitemap = await outputText(output, 'sitemap-0.xml');
    for (const slug of [
      '',
      'fixture-alpha/',
      'fixture-zeta/',
      'fixture-old/',
    ]) {
      const url = `https://maelstrom-ai.co/blog/${slug}`;
      const html = await outputText(output, `blog/${slug}index.html`);
      expect(html).toContain(`rel="canonical" href="${url}"`);
      expect(html).toContain(`property="og:url" content="${url}"`);
      expect(sitemap).toContain(`<loc>${url}</loc>`);
      expect(html).not.toContain('name="robots"');
    }
    const article = await outputText(output, 'blog/fixture-alpha/index.html');
    expect(article).toContain('<strong>rendered Markdown</strong>');
    expect(article).toContain('data-testid="mdx-expression">42</span>');
    expect(article).toContain('property="og:type" content="article"');
    expect(article).toContain(
      'property="article:published_time" content="2026-01-02T00:00:00.000Z"',
    );
    expect(article).toContain(
      'property="article:author" content="https://example.com/author"',
    );
    expect(article).toContain('name="keywords" content="engineering, MDX"');
    expect(article).toContain(
      'property="og:image" content="https://maelstrom-ai.co/og.png"',
    );
    expect(await outputText(output, 'blog/fixture-zeta/index.html')).toContain(
      'property="og:image" content="https://example.com/fixture.png"',
    );
    expect((await readdir(join(output, 'blog'))).sort()).toEqual([
      'fixture-alpha',
      'fixture-old',
      'fixture-zeta',
      'index.html',
    ]);
    expect(sitemap).not.toContain('/blog/pages');

    build('https://preview.example');
    const previewArticle = await outputText(
      output,
      'blog/fixture-alpha/index.html',
    );
    const previewHome = await outputText(output, 'index.html');
    // Static prerendering does not re-evaluate Layout's request-host noindex guard.
    expect(previewArticle.includes('name="robots"')).toBe(
      previewHome.includes('name="robots"'),
    );
    expect(previewHome).toContain(
      'rel="canonical" href="https://preview.example/"',
    );
    expect(previewArticle).toContain(
      'rel="canonical" href="https://maelstrom-ai.co/blog/fixture-alpha/"',
    );
    expect(await outputText(output, 'sitemap-0.xml')).toContain(
      '<loc>https://maelstrom-ai.co/blog/fixture-alpha/</loc>',
    );

    await mkdir(join(content, 'nested'));
    await writeFile(
      join(content, 'nested/invalid.mdx'),
      '---\ntitle: Invalid\n---\nInvalid',
    );
    expect(build).toThrow('Blog filenames must be flat');
    await rm(join(content, 'nested'), { recursive: true });
    await writeFile(
      join(content, 'invalid.mdx'),
      '---\ntitle: Invalid\n---\nInvalid',
    );
    expect(build).toThrow();
  });
}, 300_000);
