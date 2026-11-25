import { expect, test } from 'bun:test';

import worker from '../src/narration-delivery-worker.js';

const voiceHash = 'a'.repeat(64);
const textHash = 'b'.repeat(64);
const version = 'c'.repeat(64);
const prefix = 'production-delivery';
const manifest = `manifests/${voiceHash}/${textHash}.json`;
const wav = `${version}/0.wav`;
const commit = `committed/${version}.json`;
const pointer = JSON.stringify({ voiceHash, textHash, chunkCount: 1 });
const fullManifest = JSON.stringify({
  voiceHash,
  textHash,
  version,
  chunks: [{}],
});

function fixture() {
  const values = new Map<string, string>();
  const reads: string[] = [];
  const heads: string[] = [];
  const httpEtag = '"immutable"';
  const env = {
    NARRATION_BUCKET: {
      async head(key: string) {
        heads.push(key);
        const value = values.get(key);
        return value === undefined ? null : { size: value.length, httpEtag };
      },
      async get(
        key: string,
        options?: { range: { offset: number; length: number } },
      ) {
        reads.push(key);
        const value = values.get(key);
        if (value === undefined) return null;
        const range = options?.range;
        const bytes = range
          ? value.slice(range.offset, range.offset + range.length)
          : value;
        return {
          size: value.length,
          httpEtag,
          body: new Blob([bytes]).stream(),
        };
      },
    },
  };
  return {
    reads,
    heads,
    store(path: string, value: string) {
      values.set(`${prefix}/${path}`, value);
    },
    async request(path: string, init?: RequestInit, host = 'maelstrom-ai.co') {
      return worker.fetch(
        new Request(`https://${host}/_blog-narration/${path}`, init),
        env,
      );
    },
  };
}

test('private data, traversal, writes, and unrelated hosts never reach R2', async () => {
  const mock = fixture();
  for (const path of [
    'blog-narration/attempt.json',
    commit,
    'production-delivery/committed/private.json',
    '../staff/report.json',
    '%2e%2e/staff/report.json',
    'manifests/private.json',
    `${version}/%2f0.wav`,
    `${version}/00.wav`,
    `${version}/10000.wav`,
  ]) {
    expect((await mock.request(path)).status).toBe(404);
  }
  expect((await mock.request(wav, {}, 'docs.maelstrom-ai.co')).status).toBe(
    404,
  );
  const write = await mock.request(manifest, {
    method: 'PUT',
    body: 'untrusted',
  });
  expect(write.status).toBe(405);
  expect(write.headers.get('allow')).toBe('GET, HEAD');
  expect(mock.reads).toEqual([]);
});

test('an interrupted publish never exposes staged audio and misses allow the next request to see the commit', async () => {
  const mock = fixture();
  mock.store(wav, 'wave data!');
  mock.store(commit, pointer);
  for (const path of [manifest, wav]) {
    const missing = await mock.request(path);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
  }

  expect(mock.reads).not.toContain(`${prefix}/${wav}`);
  mock.store(manifest, fullManifest);
  for (const chunkCount of [0, 1.5, 10_001]) {
    mock.store(commit, JSON.stringify({ voiceHash, textHash, chunkCount }));
    expect((await mock.request(wav)).status).toBe(404);
  }
  mock.store(commit, pointer);

  const discovered = await mock.request(manifest, {}, 'www.maelstrom-ai.co');
  expect(discovered.status).toBe(200);
  expect(discovered.headers.get('content-type')).toBe('application/json');
  expect(await discovered.text()).toBe(fullManifest);
  expect(await (await mock.request(wav)).text()).toBe('wave data!');

  mock.store(`${version}/1.wav`, 'unlisted chunk');
  expect((await mock.request(`${version}/1.wav`)).status).toBe(404);
});

test('media supports HEAD and single byte ranges for audio seeking', async () => {
  const mock = fixture();
  mock.store(commit, pointer);
  mock.store(manifest, fullManifest);
  mock.store(wav, 'wave data!');

  const head = await mock.request(wav, {
    method: 'HEAD',
    headers: { range: 'bytes=0-0' },
  });
  expect(head.status).toBe(200);
  expect(head.headers.get('content-length')).toBe('10');
  expect(head.headers.get('accept-ranges')).toBe('bytes');
  expect(head.headers.get('content-type')).toBe('audio/wav');
  expect(head.headers.get('cache-control')).toBe(
    'public, max-age=31536000, immutable',
  );
  expect(await head.text()).toBe('');

  for (const [range, expected, contentRange] of [
    ['bytes=5-8', 'data', 'bytes 5-8/10'],
    ['bytes=5-', 'data!', 'bytes 5-9/10'],
    ['bytes=-5', 'data!', 'bytes 5-9/10'],
    ['bytes=5-99999999999999999999', 'data!', 'bytes 5-9/10'],
  ]) {
    const partial = await mock.request(wav, { headers: { range } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(contentRange);
    expect(partial.headers.get('content-length')).toBe(String(expected.length));
    expect(await partial.text()).toBe(expected);
  }

  const failed = await mock.request(wav, { headers: { range: 'bytes=10-' } });
  expect(failed.status).toBe(416);
  expect(failed.headers.get('content-range')).toBe('bytes */10');
  const changed = await mock.request(wav, {
    headers: { range: 'bytes=5-', 'if-range': '"different"' },
  });
  expect(changed.status).toBe(200);
  expect(await changed.text()).toBe('wave data!');
});

test('a later manifest for edited speech keeps the older version seekable', async () => {
  const mock = fixture();
  mock.store(commit, pointer);
  mock.store(manifest, fullManifest);
  mock.store(wav, 'original');
  const updatedTextHash = 'd'.repeat(64);
  const updatedVersion = 'e'.repeat(64);
  mock.store(
    `committed/${updatedVersion}.json`,
    JSON.stringify({ voiceHash, textHash: updatedTextHash, chunkCount: 1 }),
  );
  mock.store(
    `manifests/${voiceHash}/${updatedTextHash}.json`,
    JSON.stringify({
      voiceHash,
      textHash: updatedTextHash,
      version: updatedVersion,
      chunks: [{}],
    }),
  );
  mock.store(`${updatedVersion}/0.wav`, 'updated');

  expect(await (await mock.request(`${updatedVersion}/0.wav`)).text()).toBe(
    'updated',
  );
  const original = await mock.request(wav, { headers: { range: 'bytes=-4' } });
  expect(original.status).toBe(206);
  expect(await original.text()).toBe('inal');
});

test('the maximum manifest stays readable and seeks use only its metadata', async () => {
  const mock = fixture();
  const limit = 25 * 1024 * 1024;
  const recording = fullManifest.padEnd(limit);
  mock.store(manifest, recording);
  mock.store(commit, pointer);
  mock.store(wav, 'wave data!');

  const partial = await mock.request(wav, { headers: { range: 'bytes=5-8' } });
  expect(partial.status).toBe(206);
  expect(await partial.text()).toBe('data');
  expect(mock.reads).toEqual([`${prefix}/${commit}`, `${prefix}/${wav}`]);
  expect(mock.heads).toContain(`${prefix}/${manifest}`);

  const head = await mock.request(manifest, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.headers.get('content-length')).toBe(String(limit));
  const advertised = await mock.request(manifest);
  expect(advertised.status).toBe(200);
  expect(advertised.body).toBeTruthy();
  expect((await advertised.arrayBuffer()).byteLength).toBe(limit);

  mock.store(manifest, recording + ' ');
  for (const response of [
    await mock.request(manifest),
    await mock.request(manifest, { method: 'HEAD' }),
    await mock.request(manifest, { headers: { range: 'bytes=0-1' } }),
    await mock.request(wav),
  ]) {
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});
