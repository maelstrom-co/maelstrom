import { expect, test } from 'bun:test';

import { memoryStore, mockSecret } from '../e2e/fixtures/blog/narration';
import {
  narrationDigest,
  narrationManifestPath,
} from '../src/lib/blog-narration';
import { authorizeHeldAttempt } from './blog-narration-attempt';
import { recoverProductionNarration } from './blog-narration-production-publication';
import {
  narrationVoiceHash,
  publishNarrationArticle,
  splitNarration,
  type NarrationPublication,
} from './blog-narration-publication';

const slug = '/blog/article/';

async function fixture(body: string, limit?: number) {
  const objects = new Map<string, string>();
  const delivery = new Map<string, string | Uint8Array>();
  let release = 'a'.repeat(40);
  let time = 0;
  let requests = 0;
  let paidCharacters = 0;
  const options = {
    apiKey: mockSecret,
    voiceId: 'myvoice',
    voiceRevision: '1',
    limit,
    now: () => time,
    async request(_url: string, init: RequestInit) {
      const { text } = JSON.parse(String(init.body));
      const characters = [...text];
      const seconds = (index: number) => index / 8_000;
      requests++;
      paidCharacters += text.length;
      return Response.json({
        audio_base64: Buffer.alloc(characters.length * 4 + 4).toString(
          'base64',
        ),
        alignment: {
          characters,
          character_start_times_seconds: characters.map((_, index) =>
            seconds(index),
          ),
          character_end_times_seconds: characters.map((_, index) =>
            seconds(index + 1),
          ),
        },
      });
    },
  } satisfies Omit<NarrationPublication, 'store'>;
  const voice = await narrationVoiceHash(options);
  const marker = () =>
    `data-narration-release="${release}" data-narration-voice="${voice}"`;
  function publishText(next: string) {
    body = next;
    release = String.fromCharCode(release.charCodeAt(0) + 1).repeat(40);
  }
  const key = async () =>
    narrationManifestPath(
      voice,
      await narrationDigest(`Story title Short description. ${body.trim()}`),
    ).replace('/_blog-narration/', 'production-delivery/');
  const runs = {
    requestPage: async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe('https://maelstrom-ai.co');
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('error');
      return new Response(
        url.pathname === '/blog/'
          ? `<main class="blog-archive" ${marker()}><ul class="blog-list"><li class="blog-card"><h2><a href="${slug}">Story</a></h2></li></ul></main>`
          : `<main class="blog-page" ${marker()}><article><header><h1 data-narration-text>Story title</h1><p data-narration-text>Short description.</p></header><div class="blog-prose" data-narration-text><p>${body}</p></div></article></main>`,
        { headers: { 'content-type': 'text/html' } },
      );
    },
    async readDelivery(key: string) {
      const stored = delivery.get(key);
      return typeof stored === 'string' ? stored : undefined;
    },
    async deliver(key: string, value: string | Uint8Array) {
      delivery.set(key, value);
    },
  };
  const fresh = () => ({
    ...runs,
    publication: { ...options, store: memoryStore(objects) },
  });
  return {
    fresh,
    key,
    delivery,
    objects,
    publishText,
    requests: () => requests,
    paid: () => paidCharacters,
    advance(ms: number) {
      time += ms;
    },
  };
}

test('a new runner can finish a long production recording without a website rebuild', async () => {
  const fixtureLong = await fixture('word '.repeat(5_000));
  const key = await fixtureLong.key();
  expect(await recoverProductionNarration(fixtureLong.fresh())).toMatchObject({
    published: 0,
  });
  expect(fixtureLong.delivery.has(key)).toBe(false);
  const paidFirst = fixtureLong.paid();
  expect(paidFirst).toBeGreaterThan(0);
  expect(paidFirst).toBeLessThanOrEqual(20_000);

  expect(await recoverProductionNarration(fixtureLong.fresh())).toMatchObject({
    published: 1,
  });
  expect(fixtureLong.delivery.has(key)).toBe(true);
  expect(fixtureLong.paid()).toBe(
    'Story title Short description. '.length + 24_999,
  );
  const requests = fixtureLong.requests();
  expect(await recoverProductionNarration(fixtureLong.fresh())).toMatchObject({
    published: 0,
  });
  expect(fixtureLong.requests()).toBe(requests);
});

test('release changes prevent stale publication and leave later committed audio immutable', async () => {
  const published = await fixture('Original words.');
  const originalKey = await published.key();
  await recoverProductionNarration(published.fresh());
  const original = published.delivery.get(originalKey);
  expect(typeof original).toBe('string');
  const oldVersion = JSON.parse(String(original)).version;
  const oldMediaKey = `production-delivery/${oldVersion}/0.wav`;
  const oldBytes = published.delivery.get(oldMediaKey);

  published.publishText('Edited words.');
  const editedKey = await published.key();
  expect(published.delivery.has(editedKey)).toBe(false);

  const recovery = published.fresh();
  const racing = {
    ...recovery,
    async deliver(key: string, value: string | Uint8Array) {
      await recovery.deliver(key, value);
      if (key.endsWith('.wav')) published.publishText('Newest words.');
    },
  };
  expect(await recoverProductionNarration(racing)).toMatchObject({
    published: 0,
  });
  expect(published.delivery.has(editedKey)).toBe(false);

  const newest = await published.key();
  await recoverProductionNarration(published.fresh());
  expect(published.delivery.has(newest)).toBe(true);
  published.advance(8 * 24 * 60 * 60 * 1000);
  await recoverProductionNarration(published.fresh());
  expect(published.delivery.get(originalKey)).toBe(original);
  expect(published.delivery.get(oldMediaKey)).toEqual(oldBytes);
});

test('an oversized manifest is rejected before the first paid production request', async () => {
  const large = await fixture('a '.repeat(210_000));
  const diagnostics: string[] = [];
  expect(
    await recoverProductionNarration({
      ...large.fresh(),
      report: (message) => diagnostics.push(message),
    }),
  ).toMatchObject({ published: 0 });
  expect(large.requests()).toBe(0);
  expect(large.delivery.size).toBe(0);
  expect(diagnostics).toEqual([
    'Narration manifest would exceed its serving limit',
  ]);
});

test('fresh recovery reuses legacy multiline bytes and remaps their playable offsets', async () => {
  const published = await fixture('Original narration.');
  const legacyText = 'Story title\n\nShort description.\n\nOriginal narration.';
  const canonicalText = 'Story title Short description. Original narration.';
  let originalManifest = '';
  const originalAudio = new Map<string, Uint8Array>();
  await publishNarrationArticle(legacyText, published.fresh().publication, {
    async writeAudio(path, bytes) {
      originalAudio.set(path, bytes);
    },
    async writeManifest(value) {
      originalManifest = value;
    },
  });
  expect(published.requests()).toBe(1);
  const seeded = JSON.parse(originalManifest);
  expect(seeded.textHash).toBe(await narrationDigest(legacyText));
  expect(seeded.chunks[0].words[4].from).toBeGreaterThan(
    canonicalText.indexOf('Original'),
  );
  expect(await recoverProductionNarration(published.fresh())).toMatchObject({
    published: 1,
  });
  expect(published.requests()).toBe(1);

  const delivered = JSON.parse(
    String(published.delivery.get(await published.key())),
  );
  expect(delivered.version).toBe(seeded.version);
  expect(delivered.textHash).toBe(await narrationDigest(canonicalText));
  const marker = published.delivery.get(
    `production-delivery/committed/${seeded.version}.json`,
  );
  expect(JSON.parse(String(marker))).toEqual({
    textHash: delivered.textHash,
    voiceHash: delivered.voiceHash,
    chunkCount: delivered.chunks.length,
  });
  expect(
    delivered.chunks[0].words.map(
      ({ from, to }: { from: number; to: number }) =>
        canonicalText.slice(from, to),
    ),
  ).toEqual([
    'Story',
    'title',
    'Short',
    'description',
    'Original',
    'narration',
  ]);
  for (const [path, bytes] of originalAudio) {
    expect(
      published.delivery.get(
        path.replace('/_blog-narration/', 'production-delivery/'),
      ),
    ).toEqual(bytes);
  }

  await publishNarrationArticle(
    canonicalText,
    {
      ...published.fresh().publication,
      legacyText: 'Story title\n\nShort description.\n\nOriginal\n\nnarration.',
    },
    {
      async writeAudio(path, bytes) {
        expect(bytes).toEqual(originalAudio.get(path));
      },
      async writeManifest(value) {
        expect(JSON.parse(value).version).toBe(seeded.version);
      },
    },
  );
  expect(published.requests()).toBe(1);
});

const twoChunkBody =
  'Original narration contains a collection of simple words.';
const originalLayout = `Story title\n\nShort description.\n\n${twoChunkBody}`;
const formattingEdit =
  'Original narration</p><p>contains a collection of simple words.';

test('a partial legacy recording keeps its paid hold across formatting changes until exact authorization', async () => {
  const published = await fixture(twoChunkBody, 60);
  expect(splitNarration(originalLayout, 60)).toHaveLength(2);
  const key = await published.key();
  let version = '';
  let admissions = 0;
  await expect(
    publishNarrationArticle(
      originalLayout,
      {
        ...published.fresh().publication,
        async beforeSynthesis() {
          if (++admissions === 2)
            throw new Error('Stop after first legacy chunk');
        },
      },
      {
        async writeAudio(path) {
          version = path.split('/')[2];
        },
        async writeManifest() {},
      },
    ),
  ).rejects.toThrow('Stop after first legacy chunk');
  expect(published.requests()).toBe(1);
  const interrupted = published.fresh();
  let lost = 0;
  const lostResult = {
    ...interrupted,
    publication: {
      ...interrupted.publication,
      async request() {
        lost++;
        throw new Error('Provider may have accepted the request');
      },
    },
  };
  expect(await recoverProductionNarration(lostResult)).toMatchObject({
    published: 0,
  });
  expect(lost).toBe(1);
  const heldKey = `blog-narration-attempts/${version}/1.json`;
  const { id } = JSON.parse(published.objects.get(heldKey) ?? 'null') as {
    id: string;
  };
  published.publishText(formattingEdit);
  expect(await recoverProductionNarration(published.fresh())).toMatchObject({
    published: 0,
  });
  expect(published.delivery.has(key)).toBe(false);
  expect(published.requests()).toBe(1);

  await authorizeHeldAttempt(published.fresh().publication.store, {
    version,
    index: 1,
    attemptId: id,
  });
  expect(await recoverProductionNarration(published.fresh())).toMatchObject({
    published: 1,
  });
  expect(published.requests()).toBe(2);
  expect(JSON.parse(String(published.delivery.get(key))).version).toBe(version);
  await expect(
    authorizeHeldAttempt(published.fresh().publication.store, {
      version,
      index: 1,
      attemptId: id,
    }),
  ).rejects.toThrow('no longer held');
});

test('a pinned canonical hold cannot switch to a newly discovered legacy candidate', async () => {
  const published = await fixture(twoChunkBody, 60);
  const canonical = published.fresh();
  const key = await published.key();
  let lost = 0;
  expect(
    await recoverProductionNarration({
      ...canonical,
      publication: {
        ...canonical.publication,
        async request() {
          lost++;
          throw new Error('Unknown result');
        },
      },
    }),
  ).toMatchObject({ published: 0 });
  expect(lost).toBe(1);

  // Simulate a legacy recording whose cache row is present for the newly rendered
  // paragraph layout. The previously pinned canonical attempt is authoritative.
  const legacy = await fixture(twoChunkBody, 60);
  await publishNarrationArticle(
    'Story title\n\nShort description.\n\nOriginal narration\n\ncontains a collection of simple words.',
    legacy.fresh().publication,
    { async writeAudio() {}, async writeManifest() {} },
  );
  for (const [id, value] of legacy.objects) {
    if (id.startsWith('blog-narration/')) published.objects.set(id, value);
  }
  published.publishText(formattingEdit);
  expect(await recoverProductionNarration(published.fresh())).toMatchObject({
    published: 0,
  });
  expect(published.delivery.has(key)).toBe(false);
  expect(published.requests()).toBe(0);
});

for (const competingWrite of [false, true]) {
  test(
    competingWrite
      ? 'a losing selection CAS never sends and the next runner uses the winner'
      : 'a lost selection acknowledgement sends nothing until the next runner reads the selected recording',
    async () => {
      const published = await fixture('Original narration.');
      const first = published.fresh();
      const operation = recoverProductionNarration({
        ...first,
        publication: {
          ...first.publication,
          store: {
            ...first.publication.store,
            async compareAndSet(key, value, etag) {
              const result = await first.publication.store.compareAndSet(
                key,
                value,
                etag,
              );
              if (result && key.startsWith('blog-narration-aliases/')) {
                if (competingWrite) return false;
                throw new Error('Lost selection acknowledgement');
              }
              return result;
            },
          },
        },
      });
      if (competingWrite)
        await expect(operation).resolves.toMatchObject({ published: 0 });
      else
        await expect(operation).rejects.toThrow(
          'Lost selection acknowledgement',
        );
      expect(published.requests()).toBe(0);
      expect(await recoverProductionNarration(published.fresh())).toMatchObject(
        { published: 1 },
      );
      expect(published.requests()).toBe(1);
    },
  );
}
