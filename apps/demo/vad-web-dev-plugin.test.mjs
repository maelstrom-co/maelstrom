import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createVadWebDevPlugin } from './vad-web-dev-plugin.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * Creates the middleware with an isolated generated-assets directory.
 *
 * @returns {Promise<Function>} The registered development middleware.
 */
async function createMiddleware() {
  const assetDirectory = await mkdtemp(join(tmpdir(), 'maelstrom-vad-'));
  temporaryDirectories.push(assetDirectory);
  await mkdir(join(assetDirectory, 'nested'));
  await writeFile(
    join(assetDirectory, 'ort-wasm-simd-threaded.mjs'),
    'export const ready = true;\n',
  );
  await writeFile(join(assetDirectory, 'nested', 'hidden.mjs'), 'secret');

  let middleware;
  createVadWebDevPlugin({ assetDirectory }).configureServer({
    middlewares: {
      use(candidate) {
        middleware = candidate;
      },
    },
  });

  return middleware;
}

/**
 * Creates the minimal response object needed by the Connect middleware.
 *
 * @returns {{ headers: Map<string, string>, statusCode: number, body: Buffer | undefined, setHeader: (name: string, value: string) => void, end: (body?: Buffer) => void }} A test response.
 */
function response() {
  const headers = new Map();
  return {
    headers,
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      headers.set(name, value);
    },
    end(body) {
      this.body = body;
    },
  };
}

describe('VAD web development middleware', () => {
  test('serves a VAD mjs request as JavaScript', async () => {
    const middleware = await createMiddleware();
    const res = response();
    let nextCalled = false;

    await middleware(
      { url: '/vad-web/ort-wasm-simd-threaded.mjs?worker' },
      res,
      () => {
        nextCalled = true;
      },
    );

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body.toString()).toBe('export const ready = true;\n');
    expect(res.headers.get('Content-Type')).toBe(
      'application/javascript; charset=utf-8',
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test('returns 404 for a missing VAD mjs request', async () => {
    const middleware = await createMiddleware();
    const res = response();
    let nextCalled = false;

    await middleware({ url: '/vad-web/missing.mjs' }, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  test('passes non-mjs requests to the next middleware', async () => {
    const middleware = await createMiddleware();
    const res = response();
    let nextCalled = false;

    await middleware({ url: '/vad-web/model.wasm' }, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.body).toBeUndefined();
  });

  test('rejects traversal attempts without reading outside the asset directory', async () => {
    const middleware = await createMiddleware();
    const res = response();
    let nextCalled = false;

    await middleware({ url: '/vad-web/%2e%2e/nested/hidden.mjs' }, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body).toBeUndefined();
  });
});
