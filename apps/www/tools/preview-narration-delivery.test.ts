import { expect, test } from 'bun:test';

import { S3Client } from 'bun';

import { putPreviewNarrationAsset } from './preview-narration-delivery';

test('signed writes persist cache metadata and allow credential-free cross-origin range reads', async () => {
  const objects = new Map<
    string,
    { body: Uint8Array<ArrayBuffer>; headers: Headers }
  >();
  const readerOrigin = 'https://preview.example';
  const delivery = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const key = url.pathname.split('/').at(-1) ?? '';
      if (request.method === 'PUT') {
        expect(url.searchParams.get('X-Amz-Signature')).toMatch(
          /^[a-f0-9]{64}$/u,
        );
        expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
        objects.set(key, {
          body: new Uint8Array(await request.arrayBuffer()),
          headers: request.headers,
        });
        return new Response(null, { status: 200 });
      }
      const object = objects.get(key);
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response(null, { status: 405 });
      if (!object)
        return new Response(null, {
          status: 404,
          headers: { 'cache-control': 'no-store' },
        });
      expect(request.headers.has('authorization')).toBe(false);
      expect(request.headers.has('cookie')).toBe(false);
      expect(request.headers.get('origin')).toBe(readerOrigin);
      const headers = new Headers({
        'access-control-allow-origin': readerOrigin,
        'access-control-expose-headers':
          'accept-ranges, content-range, content-length',
        'accept-ranges': 'bytes',
      });
      for (const name of ['cache-control', 'content-type']) {
        headers.set(name, object.headers.get(name) ?? '');
      }
      if (request.method === 'HEAD') {
        headers.set('content-length', String(object.body.length));
        return new Response(null, { headers });
      }
      const ranged = request.headers.get('range') === 'bytes=1-2';
      const body = ranged ? object.body.slice(1, 3) : object.body;
      if (ranged)
        headers.set('content-range', `bytes 1-2/${object.body.length}`);
      headers.set('content-length', String(body.length));
      return new Response(body, { headers, status: ranged ? 206 : 200 });
    },
  });
  const client = new S3Client({
    endpoint: delivery.url.origin,
    region: 'auto',
    bucket: 'fixture-delivery',
    accessKeyId: 'fixture-access-key',
    secretAccessKey: 'fixture-secret-key',
  });
  const request = (name: string, init: RequestInit = {}) =>
    fetch(new URL(name, delivery.url), {
      ...init,
      credentials: 'omit',
      headers: { origin: readerOrigin, ...init.headers },
    });
  try {
    const missing = await request('narration.json');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');

    await putPreviewNarrationAsset(
      client,
      'revision.wav',
      new Uint8Array([1, 2, 3, 4]),
      'audio/wav',
    );
    await putPreviewNarrationAsset(
      client,
      'narration.json',
      '{"ready":true}',
      'application/json',
    );

    const manifest = await request('narration.json');
    expect(manifest.headers.get('cache-control')).toBe('no-store');
    expect(manifest.headers.get('access-control-allow-origin')).toBe(
      readerOrigin,
    );
    expect(manifest.headers.get('content-type')).toBe('application/json');
    expect(await manifest.json()).toEqual({ ready: true });

    const head = await request('revision.wav', { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('4');
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    const range = await request('revision.wav', {
      headers: { range: 'bytes=1-2' },
    });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 1-2/4');
    expect(range.headers.get('cache-control')).toBe(
      'public, max-age=86400, immutable',
    );
    expect(range.headers.get('content-type')).toBe('audio/wav');
    expect([...new Uint8Array(await range.arrayBuffer())]).toEqual([2, 3]);
    expect((await request('revision.wav', { method: 'DELETE' })).status).toBe(
      405,
    );
  } finally {
    delivery.stop(true);
  }
});
