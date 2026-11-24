import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  fixtureSpeech,
  memoryStore,
  mockSecret,
} from '../e2e/fixtures/blog/narration';
import {
  narrationMediaPath,
  type NarrationManifest,
} from '../src/lib/blog-narration';
import { publishNarration, splitNarration } from './blog-narration-publication';

const builds: string[] = [];
let calls = 0;
const input = {
  apiKey: mockSecret,
  voiceId: 'myvoice',
  voiceRevision: '1',
  limit: 24,
  async request(url: string, init: RequestInit) {
    calls++;
    return fixtureSpeech(url, init);
  },
};
const prose =
  'Text &amp; <em>ca</em>fé again. <a href="/unspoken">again</a> in print.';

async function build(body = prose) {
  const root = await mkdtemp(join(tmpdir(), 'narration-publication-'));
  builds.push(root);
  const article = join(root, 'blog/example/index.html');
  await mkdir(dirname(article), { recursive: true });
  await writeFile(join(root, 'blog/index.html'), '<h1>Archive</h1>');
  await writeFile(
    article,
    `<!doctype html><title>SEO metadata</title>
    <h1 data-narration-text>Visible title</h1>
    <p data-narration-text>First description.</p>
    <p>Unaffiliated author</p>
    <div data-narration-text><p>${body}</p>
    <pre>ignored block code</pre><span aria-hidden="true">hidden text</span>
    <video><a href="/fallback">Fallback video link</a></video>
    <p>Last heading 🐚. 2026.</p></div>`,
  );
  return root;
}

async function manifest(root: string): Promise<NarrationManifest> {
  return JSON.parse(
    await readFile(join(root, 'blog/example/narration.json'), 'utf8'),
  );
}

afterEach(async () => {
  for (const root of builds.splice(0))
    await rm(root, { recursive: true, force: true });
  calls = 0;
});

test('publication restores immutable media on a fresh runner and versions spoken edits and voice edits', async () => {
  const objects = new Map<string, string>();
  const first = await build();
  const spoken: string[] = [];
  await publishNarration(first, {
    ...input,
    store: memoryStore(objects),
    async request(url, init) {
      spoken.push(JSON.parse(String(init.body)).text);
      return input.request(url, init);
    },
  });
  const initial = await manifest(first);
  const transcript = spoken.join('');
  expect(transcript).toBe(
    'Visible title\n\nFirst description.\n\nText & café again. again in print.\n\nLast heading 🐚. 2026.',
  );
  expect(initial.chunks.length).toBeGreaterThan(1);
  expect(calls).toBe(initial.chunks.length);
  expect(
    initial.chunks.flatMap((chunk) =>
      chunk.words.map(({ from, to }) => transcript.slice(from, to)),
    ),
  ).toEqual([
    'Visible',
    'title',
    'First',
    'description',
    'Text',
    'café',
    'again',
    'again',
    'in',
    'print',
    'Last',
    'heading',
    '2026',
  ]);
  expect(JSON.stringify(initial)).not.toContain(mockSecret);

  const fresh = await build();
  await publishNarration(fresh, { ...input, store: memoryStore(objects) });
  expect(await manifest(fresh)).toEqual(initial);
  expect(calls).toBe(initial.chunks.length);
  for (const [index, chunk] of initial.chunks.entries()) {
    const path = narrationMediaPath(initial.version, index);
    const audio = await readFile(join(fresh, path));
    expect(audio).toEqual(await readFile(join(first, path)));
    expect(audio.toString('ascii', 0, 4)).toBe('RIFF');
    expect((audio.length - 44) / 32_000).toBe(chunk.duration);
    expect(audio.includes(mockSecret)).toBe(false);
  }

  const edit = await build(prose.replace('print', 'speech'));
  await publishNarration(edit, { ...input, store: memoryStore(objects) });
  expect((await manifest(edit)).version).not.toBe(initial.version);
  expect(calls).toBeGreaterThan(initial.chunks.length);
  const callsAfterEdit = calls;
  await publishNarration(await build(), {
    ...input,
    store: memoryStore(objects),
  });
  expect(calls).toBe(callsAfterEdit);

  const changedVoice = await build();
  await publishNarration(changedVoice, {
    ...input,
    voiceRevision: '2',
    store: memoryStore(objects),
  });
  expect((await manifest(changedVoice)).version).not.toBe(initial.version);
  expect(calls).toBe(callsAfterEdit + initial.chunks.length);
});

test('a failed chunk write leaves no manifest and a retry reuses independently committed chunks', async () => {
  const objects = new Map<string, string>();
  const store = memoryStore(objects);
  const root = await build();
  await expect(
    publishNarration(root, {
      ...input,
      store: {
        ...store,
        async put(key, value) {
          if (key.endsWith('/1.json')) throw new Error('transient write');
          await store.put(key, value);
        },
      },
    }),
  ).rejects.toThrow('transient write');
  expect(objects.size).toBe(1);
  expect(calls).toBe(2);
  await expect(manifest(root)).rejects.toThrow();

  const retry = await build();
  await publishNarration(retry, { ...input, store });
  expect(calls).toBe((await manifest(retry)).chunks.length + 1);
});

test('authorization and committed-media read failures cannot cause another paid request', async () => {
  const root = await build();
  await expect(
    publishNarration(root, {
      ...input,
      store: {
        ...memoryStore(),
        async get() {
          throw new Error('forbidden');
        },
      },
    }),
  ).rejects.toThrow('forbidden');
  expect(calls).toBe(0);

  const objects = new Map<string, string>();
  await publishNarration(root, { ...input, store: memoryStore(objects) });
  const current = await manifest(root);
  const key = `blog-narration/${current.version}/0.json`;
  const stored = objects.get(key);
  if (!stored) throw new Error('Missing fixture chunk');
  const incomplete = JSON.parse(stored);
  incomplete.timing.words.shift();
  objects.set(key, JSON.stringify(incomplete));
  const corrupt = await build();
  await expect(
    publishNarration(corrupt, { ...input, store: memoryStore(objects) }),
  ).rejects.toThrow('word offsets do not match');
  expect(calls).toBe(current.chunks.length);
  await expect(manifest(corrupt)).rejects.toThrow();

  objects.delete(key);
  const fresh = await build();
  await expect(
    publishNarration(fresh, { ...input, store: memoryStore(objects) }),
  ).rejects.toThrow('missing audio');
  expect(calls).toBe(current.chunks.length);
  await expect(manifest(fresh)).rejects.toThrow();
});

test('invalid provider data cannot create a durable audio chunk or a playable article', async () => {
  for (const corruption of ['text', 'time', 'media']) {
    const root = await build();
    const objects = new Map<string, string>();
    await expect(
      publishNarration(root, {
        ...input,
        store: memoryStore(objects),
        async request(url, init) {
          const response = await fixtureSpeech(url, init);
          const data = await response.json();
          if (corruption === 'text') data.alignment.characters[0] = 'wrong';
          if (corruption === 'time')
            data.alignment.character_end_times_seconds[0] = -1;
          if (corruption === 'media') data.audio_base64 = 'AQ==';
          return Response.json(data);
        },
      }),
    ).rejects.toThrow();
    expect(objects.size).toBe(0);
    await expect(manifest(root)).rejects.toThrow();
  }
});

test('oversized words split without dropping text or breaking a Unicode surrogate pair', () => {
  const text = `💡${'𐐀'.repeat(24)} tail`;
  const chunks = splitNarration(text, 3);
  expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
  expect(
    chunks.every(
      (chunk) => chunk.text.length <= 3 && chunk.text.isWellFormed(),
    ),
  ).toBe(true);
});

test('a source word with no usable timing cannot poison the durable cache', async () => {
  for (const collapsedCharacters of [7, Number.POSITIVE_INFINITY]) {
    const root = await build();
    const objects = new Map<string, string>();
    const store = memoryStore(objects);
    await expect(
      publishNarration(root, {
        ...input,
        store,
        async request(url, init) {
          const response = await fixtureSpeech(url, init);
          const data = await response.json();
          for (const times of [
            data.alignment.character_start_times_seconds,
            data.alignment.character_end_times_seconds,
          ])
            times.fill(0, 0, collapsedCharacters);
          return Response.json(data);
        },
      }),
    ).rejects.toThrow('Invalid cached narration chunk');
    expect(objects.size).toBe(0);
    await expect(manifest(root)).rejects.toThrow();
    await publishNarration(root, { ...input, store });
    const firstWord = (await manifest(root)).chunks[0].words[0];
    expect(firstWord.from).toBe(0);
    expect(firstWord.to).toBe(7);
  }
});

test('a fitting word stays intact when the preceding boundary is near the start', () => {
  const text = 'a abcdefghi end';
  const chunks = splitNarration(text, 10);
  expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
  expect(
    chunks.flatMap((chunk) =>
      chunk.words.map(({ from, to }) => text.slice(from, to)),
    ),
  ).toEqual(['a', 'abcdefghi', 'end']);
});
