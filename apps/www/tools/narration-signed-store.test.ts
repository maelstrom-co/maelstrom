import { expect, test } from 'bun:test';

import { S3Client } from 'bun';

import { signedNarrationStore } from './publish-blog-narration';

test('signed R2 requests use the exact conditional headers and distinguish missing from denied', async () => {
  let value: string | undefined;
  let etag = '"0"';
  let sequence = 0;
  let deny = false;
  const conditions: (string | null)[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      if (deny)
        return new Response('<Code>AccessDenied</Code>', { status: 403 });
      if (request.method === 'GET') {
        return value === undefined
          ? new Response('<Error><Code>NoSuchKey</Code></Error>', {
              status: 404,
            })
          : new Response(value, { headers: { etag } });
      }
      const create = request.headers.get('if-none-match');
      const match = request.headers.get('if-match');
      conditions.push(create ?? match);
      if (
        (create === '*' && value !== undefined) ||
        (match !== null && match !== etag)
      ) {
        return new Response(null, { status: 412 });
      }
      value = await request.text();
      etag = `"${++sequence}"`;
      return new Response(null);
    },
  });
  try {
    const client = new S3Client({
      endpoint: server.url.origin,
      bucket: 'fixture-delivery',
      region: 'auto',
      accessKeyId: 'fixture-access',
      secretAccessKey: 'fixture-secret',
    });
    const store = signedNarrationStore(client);
    expect(await store.readVersioned('attempt.json')).toBeUndefined();
    expect(await store.compareAndSet('attempt.json', 'first', undefined)).toBe(
      true,
    );
    const read = await store.readVersioned('attempt.json');
    expect(read).toEqual({ value: 'first', etag: '"1"' });
    expect(await store.compareAndSet('attempt.json', 'loser', undefined)).toBe(
      false,
    );
    expect(
      await store.compareAndSet('attempt.json', 'updated', read?.etag),
    ).toBe(true);
    expect(await store.compareAndSet('attempt.json', 'stale', read?.etag)).toBe(
      false,
    );
    expect(conditions).toEqual(['*', '*', '"1"', '"1"']);
    deny = true;
    await expect(store.readVersioned('attempt.json')).rejects.toThrow(
      'Versioned narration cache read failed',
    );
  } finally {
    server.stop(true);
  }
});
