import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { glob, type Loader } from 'astro/loaders';
import { JSDOM } from 'jsdom';
import {
  addExtraPost,
  outputText,
  sourcePosts,
  withBlogBuild,
} from '../../e2e/fixtures/blog/build';
import {
  blogPath,
  blogSchema,
  blogSlug,
  productionUrl,
  sortPosts,
} from './blog';
import { blogLoader } from './blog-loader';

test.each([
  'empty-scan',
  'unlink',
  'change',
  'invalid-correction',
])('glob bootstrap retains in-flight %s and installs handlers once', async (scenario) => {
  const root = await mkdtemp(join(tmpdir(), 'blog-loader-'));
  try {
    const path = join(root, 'post.mdx');
    const watcher = Object.assign(new EventEmitter(), { add() {} });
    const entries = new Map<string, { id: string; data: unknown }>();
    const errors: string[] = [];
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let paused = false;
    let loads = 0;
    let writes = 0;
    const delegate = glob({ base: root, pattern: '*.mdx' });
    const context = {
      config: {
        root: pathToFileURL(`${root}/`),
        srcDir: pathToFileURL(`${root}/`),
      },
      collection: 'blog',
      watcher,
      logger: {
        warn() {},
        info() {},
        error: (error: string) => errors.push(error),
      },
      store: {
        keys: () => entries.keys(),
        get: (id: string) => entries.get(id),
        set: (entry: { id: string; data: unknown }) => {
          writes++;
          entries.set(entry.id, entry);
        },
        delete: (id: string) => entries.delete(id),
        clear: () => entries.clear(),
      },
      generateDigest: (contents: string) => contents,
      parseData: ({ data }: { data: { title: string } }) => {
        if (data.title === 'invalid') throw new Error('invalid title');
        return data;
      },
      entryTypes: new Map([
        [
          '.mdx',
          {
            async getEntryInfo({ contents }: { contents: string }) {
              if (!paused && scenario !== 'empty-scan') {
                paused = true;
                entered.resolve();
                await resume.promise;
              }
              return { body: '', data: { title: contents } };
            },
          },
        ],
      ]),
    } as unknown as Parameters<Loader['load']>[0];
    const loader = blogLoader(
      {
        name: delegate.name,
        async load(context) {
          loads++;
          if (!paused && scenario === 'empty-scan') {
            paused = true;
            entered.resolve();
            await resume.promise;
          }
          await delegate.load(context);
        },
      },
      () => root,
      async () => (await readdir(root)).includes('post.mdx'),
    );
    await loader.load(context);
    await writeFile(
      path,
      scenario === 'invalid-correction' ? 'invalid' : 'first',
    );
    const loading = Promise.all(
      watcher.listeners('add').map((listener) => listener(path)),
    );
    await entered.promise;
    if (scenario === 'empty-scan' || scenario === 'unlink') {
      await rm(path);
      watcher.emit('unlink', path);
    } else {
      await writeFile(path, 'corrected');
      watcher.emit('change', path);
    }
    resume.resolve();
    await loading;
    if (scenario === 'empty-scan' || scenario === 'unlink') {
      expect(entries.size).toBe(0);
      await writeFile(path, 'corrected');
      await Promise.all(
        watcher.listeners('add').map((listener) => listener(path)),
      );
    }
    expect(entries.get('post')?.data).toEqual({ title: 'corrected' });
    expect(errors.length).toBe(scenario === 'invalid-correction' ? 1 : 0);
    expect(loads).toBe(
      scenario === 'empty-scan' || scenario === 'invalid-correction' ? 2 : 1,
    );
    for (const event of ['add', 'change', 'unlink'])
      expect(watcher.listenerCount(event)).toBe(1);
    const before = writes;
    await writeFile(path, 'ordinary change');
    await Promise.all(
      watcher.listeners('change').map((listener) => listener(path)),
    );
    expect(writes).toBe(before + 1);
    expect(entries.get('post')?.data).toEqual({ title: 'ordinary change' });
    await rm(path);
    await Promise.all(
      watcher.listeners('unlink').map((listener) => listener(path)),
    );
    expect(entries.size).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
    { date: '2025-02-29' },
    { date: new Date('2026-01-02') },
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

async function expectPublished(
  output: string,
  posts: Awaited<ReturnType<typeof sourcePosts>>,
) {
  const html = await outputText(output, 'blog/index.html');
  const document = new JSDOM(html).window.document;
  const cards = [...document.querySelectorAll('.blog-list > li')];
  expect(cards).toHaveLength(posts.length);
  expect((await readdir(join(output, 'blog'))).sort()).toEqual(
    ['index.html', ...posts.map((post) => post.id)].sort(),
  );
  const sitemap = await outputText(output, 'sitemap-0.xml');
  for (const [index, post] of posts.entries()) {
    const card = cards[index];
    expect(card?.querySelector('h2 a')?.textContent).toBe(post.data.title);
    expect(card?.querySelector('h2 a')?.getAttribute('href')).toBe(
      `/blog/${post.id}/`,
    );
    expect(card?.querySelector('img')?.getAttribute('src')).toBe(
      post.data.image,
    );
    expect(card?.querySelector('time')?.getAttribute('datetime')).toBe(
      post.data.date.toISOString(),
    );
    const article = new JSDOM(
      await outputText(output, `blog/${post.id}/index.html`),
    ).window.document;
    expect(article.querySelector('h1')?.textContent).toBe(post.data.title);
    expect(
      article.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    ).toBe(`https://maelstrom-ai.co/blog/${post.id}/`);
    expect(
      article
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content'),
    ).toBe(new URL(post.data.image, 'https://maelstrom-ai.co').href);
    expect(article.querySelector('time')?.getAttribute('datetime')).toBe(
      post.data.date.toISOString(),
    );
    expect(sitemap).toContain(
      `<loc>https://maelstrom-ai.co/blog/${post.id}/</loc>`,
    );
  }
}

test('actual collection builds production, a distinct-image extra post, and cached empty output', async () => {
  await withBlogBuild(async ({ root, output, build }) => {
    const posts = await sourcePosts(root);
    build();
    await expectPublished(output, posts);
    for (const path of [
      'blog/index.html',
      'sitemap-0.xml',
      ...posts.map((post) => `blog/${post.id}/index.html`),
    ]) {
      const text = await outputText(output, path);
      expect(text).not.toContain('fixture-');
      expect(text).not.toContain('Fictional');
      expect(text).not.toContain('Example Author');
      expect(text).not.toContain('/blog/pages');
    }
    await addExtraPost(root);
    const extended = await sourcePosts(root);
    expect(extended).toHaveLength(posts.length + 1);
    build();
    await expectPublished(output, extended);
    expect(await outputText(output, 'fixture-extra.svg')).toContain('<svg');

    const cache = join(root, 'node_modules/.astro');
    const cacheBefore = await stat(cache);
    expect(await readFile(join(cache, 'data-store.json'), 'utf8')).toContain(
      'fixture-extra',
    );
    const content = join(root, 'src/content/blog');
    await rm(content, { recursive: true });
    await mkdir(content);
    await writeFile(
      join(content, 'README.md'),
      'Nonmatching content must not prevent reconciliation.',
    );
    await mkdir(join(content, '.hidden'));
    await writeFile(
      join(content, '.hidden/ignored.mdx'),
      'Not a visible glob match',
    );
    await writeFile(join(content, '.ignored.mdx'), 'Not a visible file');
    await mkdir(join(content, 'directory.mdx'));
    expect(await sourcePosts(root)).toEqual([]);
    build();
    expect((await stat(cache)).ino).toBe(cacheBefore.ino);
    expect(await outputText(output, 'blog/index.html')).toContain(
      'No posts yet.',
    );
    expect(await readdir(join(output, 'blog'))).toEqual(['index.html']);
    const sitemap = await outputText(output, 'sitemap-0.xml');
    for (const post of extended)
      expect(sitemap).not.toContain(`/blog/${post.id}/`);
  });
}, 300_000);

test.each([
  '2026-02-30',
  '"2026-02-30"',
  '"2025-02-29"',
  '2024-02-29',
])('real YAML rejects date %s through collection schema validation', async (date) => {
  expect.assertions(2);
  await withBlogBuild(async ({ root, build, inject }) => {
    await inject();
    const path = join(root, 'src/content/blog/fixture-alpha.mdx');
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace(/^date:.*$/m, `date: ${date}`),
    );
    try {
      build();
    } catch (error) {
      expect(String(error)).toContain('date');
      expect(String(error)).toContain('does not match collection schema');
    }
  });
}, 180_000);

test('real YAML accepts a quoted leap day and preserves its chronological position', async () => {
  await withBlogBuild(async ({ root, output, build, inject }) => {
    await inject();
    const path = join(root, 'src/content/blog/fixture-alpha.mdx');
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace(
        /^date:.*$/m,
        'date: "2024-02-29"',
      ),
    );
    const posts = await sourcePosts(root);
    expect(posts.map((post) => post.id)).toEqual([
      'fixture-zeta',
      'fixture-old',
      'fixture-alpha',
    ]);
    build();
    await expectPublished(output, posts);
    expect(await outputText(output, 'blog/fixture-alpha/index.html')).toContain(
      '2024-02-29T00:00:00.000Z',
    );
  });
}, 180_000);

test('actual collection builds isolated empty and controlled fixture output', async () => {
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
