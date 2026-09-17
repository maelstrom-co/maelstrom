import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createBuildPublicAssetsPlugin,
  createVadWebDevPlugin,
} from './vad-web-dev-plugin.ts';
import createViteConfig, {
  hostedVadAssetNames,
  resolveBrowserKeyMode,
} from './vite.config.mjs';

const temporaryDirectories = [];

describe('resolveBrowserKeyMode', () => {
  test('uses browser custody for hosted builds', () => {
    expect(resolveBrowserKeyMode(true, 'sk-server-key')).toBe('1');
  });

  test('uses browser custody locally when the server key is missing or blank', () => {
    expect(resolveBrowserKeyMode(false, undefined)).toBe('1');
    expect(resolveBrowserKeyMode(false, '   ')).toBe('1');
  });

  test('uses server custody locally when an OpenAI key is configured', () => {
    expect(resolveBrowserKeyMode(false, 'sk-server-key')).toBe('0');
  });

  test('runs local Jev without a browser key but cannot bypass hosted custody', () => {
    const profile = demoPackage.scripts['dev-jev'];
    expect(profile).toContain('MAELSTROM_PLANNER=jev');
    expect(profile).toContain('VITE_BROWSER_KEY_MODE=0');
    expect(profile).toContain('bun run dev');
    expect(demoPackage.nx.targets['dev-jev'].dependsOn).toContain('^build');
    expect(resolveBrowserKeyMode(false, undefined, '0')).toBe('0');
    expect(resolveBrowserKeyMode(true, undefined, '0')).toBe('1');
  });

  test.each([
    false,
    true,
  ])('applies the Jev profile browser flag through Vite, hosted=%s', async (hosted) => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('VITE_HOSTED', hosted ? '1' : '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    vi.stubEnv('MAELSTROM_PLANNER', 'jev');
    try {
      await createViteConfig({ command: 'serve', mode: 'development' });
      expect(process.env.VITE_BROWSER_KEY_MODE).toBe(hosted ? '1' : '0');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

const demoPackage = JSON.parse(
  await readFile(new URL('./package.json', import.meta.url), 'utf8'),
);

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

/**
 * Runs the build public-assets plugin with a fake Vite emission context.
 *
 * @param {Parameters<typeof createBuildPublicAssetsPlugin>[0]} options Plugin options.
 * @returns {Promise<Array<{ type: string, fileName: string, source: Buffer }>>} Emitted assets.
 */
async function generateBuildAssets(options) {
  const emitted = [];
  const plugin = createBuildPublicAssetsPlugin(options);
  await plugin.generateBundle.call({
    emitFile(asset) {
      emitted.push(asset);
    },
  });
  return emitted;
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

describe('build public assets', () => {
  test('skips vad-web before reads while retaining nested assets and favicon', async () => {
    const publicDirectory = await mkdtemp(join(tmpdir(), 'maelstrom-public-'));
    temporaryDirectories.push(publicDirectory);
    await mkdir(join(publicDirectory, 'vad-web'));
    await mkdir(join(publicDirectory, 'images', 'nested'), { recursive: true });
    await writeFile(join(publicDirectory, 'vad-web', 'model.wasm'), 'vad');
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');
    await writeFile(
      join(publicDirectory, 'images', 'nested', 'logo.svg'),
      '<svg />',
    );

    const reads = [];
    const emitted = await generateBuildAssets({
      build: true,
      publicDirectory,
      async beforeReadAssets(assets) {
        reads.push(...assets.map((asset) => asset.path));
      },
    });

    expect(reads.every((path) => !path.includes('vad-web'))).toBe(true);
    expect(emitted).toEqual([
      { type: 'asset', fileName: 'favicon.ico', source: Buffer.from('icon') },
      {
        type: 'asset',
        fileName: 'images/nested/logo.svg',
        source: Buffer.from('<svg />'),
      },
    ]);
  });

  test('emits only the requested validated VAD assets', async () => {
    const publicDirectory = await mkdtemp(join(tmpdir(), 'maelstrom-public-'));
    temporaryDirectories.push(publicDirectory);
    await mkdir(join(publicDirectory, 'vad-web'));
    await writeFile(join(publicDirectory, 'vad-web', 'model.onnx'), 'model');
    await writeFile(join(publicDirectory, 'vad-web', 'unused.wasm'), 'unused');
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');

    expect(
      await generateBuildAssets({
        build: true,
        publicDirectory,
        requiredVadWebAssetNames: ['model.onnx'],
      }),
    ).toEqual([
      { type: 'asset', fileName: 'favicon.ico', source: Buffer.from('icon') },
      {
        type: 'asset',
        fileName: 'vad-web/model.onnx',
        source: Buffer.from('model'),
      },
    ]);
  });

  test('rejects a missing required VAD asset before emitting files', async () => {
    const publicDirectory = await mkdtemp(join(tmpdir(), 'maelstrom-public-'));
    temporaryDirectories.push(publicDirectory);
    await mkdir(join(publicDirectory, 'vad-web'));
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');

    await expect(
      generateBuildAssets({
        build: true,
        publicDirectory,
        requiredVadWebAssetNames: ['model.onnx'],
      }),
    ).rejects.toThrow(/model\.onnx/);
  });

  test('emits contained files whose names start with two dots', async () => {
    const publicDirectory = await mkdtemp(join(tmpdir(), 'maelstrom-public-'));
    temporaryDirectories.push(publicDirectory);
    await writeFile(join(publicDirectory, '..metadata.json'), '{}');

    expect(await generateBuildAssets({ build: true, publicDirectory })).toEqual(
      [
        {
          type: 'asset',
          fileName: '..metadata.json',
          source: Buffer.from('{}'),
        },
      ],
    );
  });

  test('normalizes Windows-style relative paths for Vite emission', async () => {
    const publicDirectory = await mkdtemp(join(tmpdir(), 'maelstrom-public-'));
    temporaryDirectories.push(publicDirectory);
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');

    expect(
      await generateBuildAssets({
        build: true,
        publicDirectory,
        relativePath: () => 'nested\\favicon.ico',
      }),
    ).toEqual([
      {
        type: 'asset',
        fileName: 'nested/favicon.ico',
        source: Buffer.from('icon'),
      },
    ]);
  });

  test('skips a top-level vad-web symlink without resolving its target', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maelstrom-public-vad-link-'));
    temporaryDirectories.push(parent);
    const publicDirectory = join(parent, 'public');
    const externalVadDirectory = join(parent, 'external-vad');
    await mkdir(publicDirectory);
    await mkdir(externalVadDirectory);
    await writeFile(join(externalVadDirectory, 'model.wasm'), 'vad');
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');
    await symlink(externalVadDirectory, join(publicDirectory, 'vad-web'));

    expect(await generateBuildAssets({ build: true, publicDirectory })).toEqual(
      [{ type: 'asset', fileName: 'favicon.ico', source: Buffer.from('icon') }],
    );
  });

  test('rejects a VAD symlink when hosted assets are requested', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maelstrom-public-vad-link-'));
    temporaryDirectories.push(parent);
    const publicDirectory = join(parent, 'public');
    const externalVadDirectory = join(parent, 'external-vad');
    await mkdir(publicDirectory);
    await mkdir(externalVadDirectory);
    await writeFile(join(externalVadDirectory, 'model.onnx'), 'vad');
    await symlink(externalVadDirectory, join(publicDirectory, 'vad-web'));

    await expect(
      generateBuildAssets({
        build: true,
        publicDirectory,
        requiredVadWebAssetNames: ['model.onnx'],
      }),
    ).rejects.toThrow(/symlink/i);
  });

  test.each([
    '.vad-web.backup-interrupted',
    '.vad-web.stage-interrupted',
  ])('rejects top-level transaction debris %s before reading or emitting assets', async (transactionDirectory) => {
    const publicDirectory = await mkdtemp(
      join(tmpdir(), 'maelstrom-public-transaction-debris-'),
    );
    temporaryDirectories.push(publicDirectory);
    await mkdir(join(publicDirectory, transactionDirectory));
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');

    let readPhaseStarted = false;
    const emitted = [];
    const plugin = createBuildPublicAssetsPlugin({
      build: true,
      publicDirectory,
      beforeReadAssets() {
        readPhaseStarted = true;
      },
    });

    await expect(
      plugin.generateBundle.call({
        emitFile(asset) {
          emitted.push(asset);
        },
      }),
    ).rejects.toThrow(/transaction/i);
    expect(readPhaseStarted).toBe(false);
    expect(emitted).toEqual([]);
  });

  test('is a no-op outside build mode', async () => {
    const emitted = await generateBuildAssets({
      build: false,
      publicDirectory: '/path/that/must/not/be-read',
      beforeReadAssets() {
        throw new Error('local mode must not read public assets');
      },
    });

    expect(emitted).toEqual([]);
  });

  test('is a no-op when the public root is missing', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maelstrom-missing-public-'));
    temporaryDirectories.push(parent);

    expect(
      await generateBuildAssets({
        build: true,
        publicDirectory: join(parent, 'missing'),
      }),
    ).toEqual([]);
  });

  test('rejects an escaping symlink before emitting any assets', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maelstrom-public-symlink-'));
    temporaryDirectories.push(parent);
    const publicDirectory = join(parent, 'public');
    await mkdir(publicDirectory);
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');
    await writeFile(join(parent, 'outside.txt'), 'outside');
    await symlink(
      join(parent, 'outside.txt'),
      join(publicDirectory, 'escape.txt'),
    );

    const emitted = [];
    const plugin = createBuildPublicAssetsPlugin({
      build: true,
      publicDirectory,
    });

    await expect(
      plugin.generateBundle.call({
        emitFile(asset) {
          emitted.push(asset);
        },
      }),
    ).rejects.toThrow(/symlink/i);
    expect(emitted).toEqual([]);
  });

  test('does not read or partially emit when prevalidation fails', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maelstrom-public-invalid-'));
    temporaryDirectories.push(parent);
    const publicDirectory = join(parent, 'public');
    await mkdir(publicDirectory);
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');
    await symlink(join(parent, 'missing'), join(publicDirectory, 'invalid'));

    let readPhaseStarted = false;
    const emitted = [];
    const plugin = createBuildPublicAssetsPlugin({
      build: true,
      publicDirectory,
      beforeReadAssets() {
        readPhaseStarted = true;
      },
    });

    await expect(
      plugin.generateBundle.call({
        emitFile(asset) {
          emitted.push(asset);
        },
      }),
    ).rejects.toThrow(/symlink/i);
    expect(readPhaseStarted).toBe(false);
    expect(emitted).toEqual([]);
  });

  test('rejects a final-file symlink swap without emitting external bytes', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maelstrom-public-file-race-'));
    temporaryDirectories.push(parent);
    const publicDirectory = join(parent, 'public');
    const assetPath = join(publicDirectory, 'favicon.ico');
    await mkdir(publicDirectory);
    await writeFile(assetPath, 'safe');
    const externalPath = join(parent, 'external.txt');
    await writeFile(externalPath, 'external');

    const emitted = [];
    const plugin = createBuildPublicAssetsPlugin({
      build: true,
      publicDirectory,
      async beforeReadAssets() {
        await rename(assetPath, join(parent, 'original.ico'));
        await symlink(externalPath, assetPath);
      },
    });

    await expect(
      plugin.generateBundle.call({
        emitFile(asset) {
          emitted.push(asset);
        },
      }),
    ).rejects.toThrow();
    expect(emitted).toEqual([]);
  });

  test('rejects an ancestor-directory symlink swap without partial emission', async () => {
    const parent = await mkdtemp(
      join(tmpdir(), 'maelstrom-public-directory-race-'),
    );
    temporaryDirectories.push(parent);
    const publicDirectory = join(parent, 'public');
    const assetDirectory = join(publicDirectory, 'images');
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(join(publicDirectory, 'favicon.ico'), 'icon');
    await writeFile(join(assetDirectory, 'logo.svg'), 'safe');
    const externalDirectory = join(parent, 'external');
    await mkdir(externalDirectory);
    await writeFile(join(externalDirectory, 'logo.svg'), 'external');

    const emitted = [];
    const plugin = createBuildPublicAssetsPlugin({
      build: true,
      publicDirectory,
      async beforeReadAssets() {
        await rename(assetDirectory, join(parent, 'original-images'));
        await symlink(externalDirectory, assetDirectory);
      },
    });

    await expect(
      plugin.generateBundle.call({
        emitFile(asset) {
          emitted.push(asset);
        },
      }),
    ).rejects.toThrow();
    expect(emitted).toEqual([]);
  });
});

describe('demo voice asset targets', () => {
  test('limits hosted VAD output to the configured legacy WASM runtime', () => {
    expect(hostedVadAssetNames).toEqual([
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
      'silero_vad_legacy.onnx',
      'vad.worklet.bundle.min.js',
    ]);
    expect(demoPackage.scripts['prepare:voice-assets']).toBe(
      'bun ../../packages/realtime-vad/dist/bin/maelstrom-vad-assets.js public/vad-web',
    );
  });

  test('keeps ordinary builds asset-free and prepares the LiveKit build', () => {
    expect(demoPackage.scripts.build).toBe('vite build');
    expect(demoPackage.scripts['build-livekit']).toBe(
      'bunx nx run @maelstrom-co/demo:build-livekit',
    );
    expect(demoPackage.nx.targets['build-livekit']).toMatchObject({
      executor: 'nx:run-commands',
      dependsOn: ['...', '^build', 'prepare-voice-assets'],
      options: {
        cwd: 'apps/demo',
        command: 'vite build --mode livekit',
      },
    });
    expect(demoPackage.nx.targets['build-hosted'].dependsOn).toEqual([
      '^build',
      'build',
      'prepare-voice-assets',
    ]);
  });

  test.each([
    'serve',
    'dev',
    'dev-livekit',
  ])('preserves inferred %s options and prepares assets first', (target) => {
    expect(demoPackage.nx.targets[target]).toMatchObject({
      '...': true,
      dependsOn: ['...', 'prepare-voice-assets'],
    });
  });

  test('preserves inherited ordinary-build dependencies without preparing assets', () => {
    expect(demoPackage.nx.targets.build).toMatchObject({
      '...': true,
      dependsOn: ['...', '^build'],
    });
    expect(demoPackage.nx.targets.build.dependsOn).not.toContain(
      'prepare-voice-assets',
    );
  });

  test('routes the client development script through prepared Nx serve', () => {
    expect(demoPackage.scripts['dev:client']).toBe(
      'bunx nx run @maelstrom-co/demo:serve',
    );
  });

  test('routes LiveKit client development through prepared Nx serve in livekit mode', () => {
    expect(demoPackage.scripts['dev:client:livekit']).toBe(
      'bunx nx run @maelstrom-co/demo:serve -- --mode livekit',
    );
  });
});

describe('Vite public asset modes', () => {
  test.each([
    { command: 'build', mode: 'production', copyPublicDir: false },
    { command: 'build', mode: 'livekit', copyPublicDir: true },
    { command: 'serve', mode: 'livekit', copyPublicDir: false },
  ])('configures public assets for $command/$mode', async (scenario) => {
    const config = await createViteConfig(scenario);

    expect(config.publicDir).toBe('public');
    expect(config.build).toMatchObject({
      copyPublicDir: scenario.copyPublicDir,
    });
    expect(config.plugins).toContainEqual(
      expect.objectContaining({ name: 'maelstrom-build-public-assets' }),
    );
  });

  test('keeps hosted output on validated asset emission even in livekit mode', async () => {
    const previousHosted = process.env.VITE_HOSTED;
    process.env.VITE_HOSTED = '1';
    try {
      const config = await createViteConfig({
        command: 'build',
        mode: 'livekit',
      });
      expect(config.build).toMatchObject({ copyPublicDir: false });
    } finally {
      if (previousHosted === undefined) {
        delete process.env.VITE_HOSTED;
      } else {
        process.env.VITE_HOSTED = previousHosted;
      }
    }
  });
});
