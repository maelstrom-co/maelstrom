import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fixtureSpeech,
  memoryStore,
  mockSecret,
} from '../e2e/fixtures/blog/narration';
import { previewNarrationBase } from '../src/lib/blog-narration-preview';
import { publishPreviewNarration } from './blog-narration-preview-publication';
import {
  publishNarration,
  type NarrationPublication,
} from './blog-narration-publication';

const base = previewNarrationBase(
  'https://delivery.example',
  '42',
  'a'.repeat(40),
);
const prefix = base.pathname.slice(1);
const slug = 'fixture-post';
const path = `/blog/${slug}/`;
const manifestPath = `${path.slice(1)}narration.json`;

const archive = (links: string[] = [path]) => `
  <main class="blog-archive" data-narration-preview-base="${base.href}">
    <a href="https://external.example/">Other links are ignored</a>
    <ul class="blog-list">${links
      .map(
        (link) => `
      <li><article class="blog-card"><h2><a href="${link}">Article</a></h2></article></li>
    `,
      )
      .join('')}</ul>
  </main>`;

const article = (
  content: string,
  resourceRoot = 'https://external.example',
  pathname = path,
) => `<!doctype html>
  <head><title>Unserved metadata</title><link rel="stylesheet" href="${resourceRoot}/style"></head>
  <main class="blog-page"><article>
    <header><h1 data-narration-text>Story title</h1><p data-narration-text>Short description.</p></header>
    <section data-narration-assets="${base.href}" data-narration-player="${base.href}${pathname.slice(1)}narration.json"></section>
    <div class="blog-prose" data-narration-text>
      <p>${content}</p>
      <script src="${resourceRoot}/script"></script>
      <script>fetch('${resourceRoot}/executed')</script>
      <script type="application/json" id="narration-input">{"text":"An injected alternate transcript", "voiceId":"other"}</script>
      <img src="${resourceRoot}/image" alt="Decorative">
      <iframe src="${resourceRoot}/frame"></iframe>
      <pre>Skipped example</pre>
    </div>
  </article></main>`;

function html(content: string) {
  return new Response(content, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

const settings = { apiKey: mockSecret, voiceId: 'myvoice', voiceRevision: '1' };

test('trusted preview fetches served HTML, stages speech before its manifest, and production reuses identical bytes', async () => {
  const output = await mkdtemp(join(tmpdir(), 'narration-preview-'));
  const requested: string[] = [];
  const spoken: string[] = [];
  const delivered = new Map<
    string,
    { asset: string | Uint8Array; type: string }
  >();
  const objects = new Map<string, string>();
  const titleContent =
    'A <a href="https://external.example/unread-path">spoken label</a> repeats repeats.';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.has('cookie')).toBe(false);
      const { pathname } = new URL(request.url);
      requested.push(pathname);
      if (pathname === '/blog/') return html(archive());
      if (pathname === path)
        return html(article(titleContent, server.url.origin));
      return new Response('Subresource should never load', { status: 404 });
    },
  });
  let failManifest = true;
  const publication: NarrationPublication = {
    ...settings,
    store: memoryStore(objects),
    limit: 24,
    async request(url, init) {
      spoken.push(JSON.parse(String(init.body)).text);
      return fixtureSpeech(url, init);
    },
  };
  const options = {
    readTarget: async () => server.url.href,
    deliveryBase: base,
    publication,
    async deliver(key: string, asset: string | Uint8Array, type: string) {
      if (key.endsWith('narration.json') && failManifest)
        throw new Error('Interrupted delivery');
      delivered.set(key, { asset, type });
    },
  };

  try {
    await expect(publishPreviewNarration(options)).rejects.toThrow(
      'Interrupted delivery',
    );
    const earlier = spoken.join('');
    expect(earlier).toBe(
      'Story title\n\nShort description.\n\nA spoken label repeats repeats.',
    );
    expect(requested).toEqual(['/blog/', path]);
    expect(delivered.size).toBeGreaterThan(1);
    expect(
      [...delivered.values()].every(({ type }) => type === 'audio/wav'),
    ).toBe(true);
    expect(delivered.has(prefix + manifestPath)).toBe(false);

    failManifest = false;
    const calls = spoken.length;
    expect(await publishPreviewNarration(options)).toMatchObject({
      status: 'published',
      published: 1,
    });
    expect(spoken).toHaveLength(calls);
    const manifest = delivered.get(prefix + manifestPath);
    expect(manifest?.type).toBe('application/json');
    const post = join(output, path);
    await mkdir(post, { recursive: true });
    await writeFile(join(post, 'index.html'), article(titleContent));
    await publishNarration(output, publication);
    expect(spoken).toHaveLength(calls);

    for (const [key, { asset }] of delivered) {
      const local = await readFile(join(output, key.slice(prefix.length)));
      expect(local).toEqual(Buffer.from(asset));
    }
    await publishNarration(output, { ...publication, voiceRevision: '2' });
    expect(spoken.length).toBeGreaterThan(calls);
    const voiceCalls = spoken.length;
    await writeFile(join(post, 'index.html'), article('Edited prose'));
    await publishNarration(output, publication);
    expect(spoken.length).toBeGreaterThan(voiceCalls);
    const committed = JSON.parse(String(manifest?.asset)) as {
      version: string;
    };
    const key = `blog-narration/${committed.version}/0.json`;
    const chunk = JSON.parse(objects.get(key) ?? '{}');
    chunk.timing.sha256 = '0'.repeat(64);
    objects.set(key, JSON.stringify(chunk));
    const beforeCorruptRetry = spoken.length;
    await expect(publishPreviewNarration(options)).rejects.toThrow(
      'Invalid cached narration chunk',
    );
    expect(spoken).toHaveLength(beforeCorruptRetry);
    expect(delivered.get(prefix + manifestPath)).toEqual(manifest);
  } finally {
    server.stop(true);
    await rm(output, { recursive: true, force: true });
  }
});

test('archive redirects, unsafe links and oversized public responses authorize no paid requests', async () => {
  const visited: string[] = [];
  let archiveResponse = () =>
    new Response(null, { status: 302, headers: { location: '/never' } });
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      visited.push(pathname);
      return pathname === '/blog/'
        ? archiveResponse()
        : html(article('Never spoken'));
    },
  });
  const options = {
    readTarget: async () => server.url.href,
    deliveryBase: base,
    async deliver() {
      throw new Error('No assets expected');
    },
    publication: {
      ...settings,
      store: memoryStore(),
      async request() {
        throw new Error('No synthesis expected');
      },
    },
  };
  try {
    await expect(publishPreviewNarration(options)).rejects.toThrow();
    archiveResponse = () =>
      html(archive(['https://external.example/blog/post/']));
    expect(await publishPreviewNarration(options)).toMatchObject({
      published: 0,
    });
    for (const unsafe of [
      'https://user:password@external.example/blog/post/',
      '/blog/post/?query=yes',
      '/blog/post/#fragment',
      '/blog/../post/',
      '/blog/hide%2Fseparator/',
      '/blog/hide%5Cseparator/',
      '/blog/post/&#10;',
    ]) {
      archiveResponse = () => html(archive([unsafe]));
      await expect(publishPreviewNarration(options)).rejects.toThrow(
        'Invalid or duplicate',
      );
    }
    archiveResponse = () => html(' '.repeat(2 * 1024 * 1024 + 1));
    await expect(publishPreviewNarration(options)).rejects.toThrow(
      'byte limit',
    );
    expect(visited).toEqual(Array<string>(10).fill('/blog/'));
  } finally {
    server.stop(true);
  }
});

test('queued or replaced preview heads cannot spend or publish a reader manifest', async () => {
  const target = 'https://preview.example/';
  let pages = 0;
  let providerCalls = 0;
  const delivered: string[] = [];
  const publication = {
    ...settings,
    store: memoryStore(),
    async request(url: string, init: RequestInit) {
      providerCalls++;
      return fixtureSpeech(url, init);
    },
  };
  const options = {
    deliveryBase: base,
    publication,
    async requestPage(url: URL) {
      pages++;
      return url.pathname === '/blog/'
        ? html(archive())
        : html(article('Shown text'));
    },
    async deliver(key: string) {
      delivered.push(key);
    },
  };
  expect(
    await publishPreviewNarration({
      ...options,
      readTarget: async () => undefined,
    }),
  ).toEqual({ status: 'stale' });
  expect(pages).toBe(0);

  let checks = 0;
  const run = (maximumChecks: number) =>
    publishPreviewNarration({
      ...options,
      readTarget: async () => (++checks <= maximumChecks ? target : undefined),
    });
  await expect(run(1)).rejects.toThrow('no longer current');
  expect(providerCalls).toBe(0);
  expect(delivered).toEqual([]);

  checks = 0;
  await expect(run(2)).rejects.toThrow('no longer current');
  expect(providerCalls).toBe(1);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toEndWith('.wav');
});

test('preview rejects extra narration marks and bounds text and total paid characters', async () => {
  let served = article('Some text').replace(
    '<main ',
    '<h1 data-narration-text>Unapproved extra</h1><main ',
  );
  let paid = 0;
  const second = '/blog/second/';
  const cached = '/blog/cached/';
  const manifests: string[] = [];
  let paths = [path];
  const options = {
    deliveryBase: base,
    readTarget: async () => 'https://preview.example/',
    async requestPage(url: URL) {
      if (url.pathname === '/blog/') return html(archive(paths));
      if (url.pathname === second)
        return html(article('next '.repeat(3_000), undefined, second));
      if (url.pathname === cached)
        return html(article('Cached story', undefined, cached));
      return html(served);
    },
    async deliver(key: string) {
      if (key.endsWith('narration.json')) manifests.push(key);
    },
    publication: {
      ...settings,
      store: memoryStore(),
      async request(_url: string, init: RequestInit) {
        const characters = [...(JSON.parse(String(init.body)).text as string)];
        paid += characters.length;
        return Response.json({
          audio_base64: Buffer.alloc((characters.length + 1) * 2).toString(
            'base64',
          ),
          alignment: {
            characters,
            character_start_times_seconds: characters.map(
              (_, index) => index / 16_000,
            ),
            character_end_times_seconds: characters.map(
              (_, index) => (index + 1) / 16_000,
            ),
          },
        });
      },
    },
  };
  await expect(publishPreviewNarration(options)).rejects.toThrow(
    'Missing eligible',
  );
  served = article('speak '.repeat(4_100));
  expect(await publishPreviewNarration(options)).toMatchObject({
    published: 0,
    skipped: { transcript: 1 },
  });
  expect(paid).toBe(0);
  paths = [cached];
  expect(await publishPreviewNarration(options)).toMatchObject({
    published: 1,
  });

  paid = 0;
  manifests.length = 0;
  served = article('speak '.repeat(3_000));
  paths = [path, second, cached];
  expect(await publishPreviewNarration(options)).toMatchObject({
    published: 2,
    skipped: { budget: 1 },
  });
  expect(paid).toBe(
    'Story title\n\nShort description.\n\n'.length + 18_000 - 1,
  );
  expect(manifests).toEqual([
    prefix + manifestPath,
    `${prefix}${cached.slice(1)}narration.json`,
  ]);
});

test('a new post is narrated even when older posts fill the archive and transcript budget', async () => {
  const paths = [
    path,
    ...Array.from({ length: 50 }, (_, index) => `/blog/older-${index}/`),
  ];
  const edited = paths[50];
  const visited: string[] = [];
  const manifests: string[] = [];
  const result = await publishPreviewNarration({
    deliveryBase: base,
    readTarget: async () => 'https://preview.example/',
    readPriorityPaths: async () => [
      edited,
      'https://external.example/blog/other/',
    ],
    async requestPage(url) {
      visited.push(url.pathname);
      if (url.pathname === '/blog/') return html(archive(paths));
      return html(
        article(
          url.pathname === path || url.pathname === edited
            ? 'New story'
            : 'old '.repeat(10_000),
          undefined,
          url.pathname,
        ),
      );
    },
    async deliver(key) {
      if (key.endsWith('narration.json')) manifests.push(key);
    },
    publication: { ...settings, store: memoryStore(), request: fixtureSpeech },
  });
  expect(visited).toEqual(['/blog/', edited, ...paths.slice(0, 39)]);
  expect(result).toMatchObject({
    published: 2,
    skipped: { older: 11, transcript: 38 },
  });
  expect(manifests).toEqual([
    `${prefix}${edited.slice(1)}narration.json`,
    prefix + manifestPath,
  ]);
});

test('older responses cannot discard a priority article when downloads hit their limits', async () => {
  const older = Array.from(
    { length: 7 },
    (_, index) => `/blog/older-${index}/`,
  );
  const visited: string[] = [];
  const manifests: string[] = [];
  let individualOnly = true;
  const publish = () =>
    publishPreviewNarration({
      deliveryBase: base,
      readTarget: async () => 'https://preview.example/',
      readPriorityPaths: async () => [path],
      async requestPage(url) {
        visited.push(url.pathname);
        if (url.pathname === '/blog/') return html(archive([...older, path]));
        const large =
          url.pathname !== path &&
          (!individualOnly || url.pathname === older[0]);
        const padding = large ? (individualOnly ? 2_100_000 : 1_900_000) : 0;
        return html(
          article('Priority story', undefined, url.pathname) +
            `<!--${' '.repeat(padding)}-->`,
        );
      },
      async deliver(key) {
        if (key.endsWith('narration.json')) manifests.push(key);
      },
      publication: {
        ...settings,
        store: memoryStore(),
        request: fixtureSpeech,
      },
    });

  expect(await publish()).toMatchObject({
    published: 7,
    skipped: { download: 1 },
  });
  expect(visited).toEqual(['/blog/', path, ...older]);
  expect(manifests).toEqual([
    prefix + manifestPath,
    ...older
      .slice(1)
      .map((route) => `${prefix}${route.slice(1)}narration.json`),
  ]);

  individualOnly = false;
  visited.length = 0;
  manifests.length = 0;
  expect(await publish()).toMatchObject({
    published: 6,
    skipped: { download: 2 },
  });
  expect(visited).toEqual(['/blog/', path, ...older.slice(0, 6)]);
  expect(manifests).toEqual([
    prefix + manifestPath,
    ...older
      .slice(0, 5)
      .map((route) => `${prefix}${route.slice(1)}narration.json`),
  ]);
});
