import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

function installedDependency(start: string, ...chain: string[]) {
  let manifest = resolve(start);
  let require = createRequire(manifest);
  for (const name of chain) {
    const candidate = require.resolve
      .paths(name)
      ?.map((path) => join(path, name, 'package.json'))
      .find(existsSync);
    if (!candidate) throw new Error(`Missing installed dependency: ${name}`);
    manifest = realpathSync(candidate);
    require = createRequire(manifest);
  }
  return { require, root: dirname(manifest) };
}

const qsPackage = installedDependency(
  'package.json',
  'verdaccio',
  'express',
  'qs',
);
const qs = qsPackage.require(qsPackage.root) as {
  parse(input: string, options: Record<string, unknown>): unknown;
  stringify(input: unknown): string;
};

test('the registry query parser cannot turn a parsed isBuffer key into a request crash', () => {
  const input = qs.parse('x[constructor][isBuffer]=value', {
    plainObjects: true,
  });
  expect(() => qs.stringify(input)).not.toThrow();
});

test('bracketed comma lists cannot bypass the registry parser array limit', () => {
  expect(() =>
    qs.parse('items[]=1,2,3,4', {
      comma: true,
      arrayLimit: 3,
      throwOnLimitExceeded: true,
    }),
  ).toThrow(RangeError);
});

const valibotPackage = installedDependency(
  'infra/platform/package.json',
  'alchemy',
  '@prisma/dev',
  'valibot',
);
const valibot = valibotPackage.require(valibotPackage.root) as {
  string(): unknown;
  number(): unknown;
  record(key: unknown, value: unknown): unknown;
  safeParse(
    schema: unknown,
    input: unknown,
  ): { success: boolean; issues: unknown };
  flatten(issues: unknown): { nested: Record<string, string[]> };
};

test('the deployment adapter cannot decode a static path past its authentication middleware', () => {
  const adapter = installedDependency(
    'infra/platform/package.json',
    'alchemy',
    '@prisma/dev',
    '@hono/node-server',
  );
  const result = spawnSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `
    import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
    import { createServer } from 'node:http';
    import { createRequire } from 'node:module';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { once } from 'node:events';
    const require = createRequire(${JSON.stringify(join(adapter.root, 'package.json'))});
    const { serve } = require('@hono/node-server');
    const { serveStatic } = require('@hono/node-server/serve-static');
    const { Hono } = require('hono');
    const root = await mkdtemp(join(tmpdir(), 'maelstrom-static-auth-'));
    let server;
    let report;
    try {
      await mkdir(join(root, 'static', 'admin'), { recursive: true });
      await writeFile(join(root, 'static', 'admin', 'secret.txt'), 'PRIVATE_FIXTURE');
      await writeFile(join(root, 'static', 'hello world.txt'), 'PUBLIC_FIXTURE');
      const app = new Hono();
      app.post('/echo', async c => c.json(await c.req.json()));
      app.use('/static/admin/*', c => c.text('Unauthorized', 401));
      app.use('/static/*', serveStatic({ root }));
      const originalRequest = globalThis.Request;
      server = serve({ createServer, fetch: app.fetch, overrideGlobalObjects: false, hostname: '127.0.0.1', port: 0 });
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('TCP fixture did not start');
      const base = 'http://127.0.0.1:' + address.port;
      async function read(path, options = {}) {
        const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(2000) });
        return { status: response.status, body: await response.text() };
      }
      report = {
        public: await read('/static/hello%20world.txt'),
        protected: await read('/static/admin/secret.txt'),
        encodedProtected: await read('/static/%61dmin/secret.txt'),
        malformed: await read('/static/%%36%31dmin/secret.txt'),
        echo: await read('/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Prisma-compatible request' }) }),
        preservesGlobals: globalThis.Request === originalRequest,
      };
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
      await rm(root, { recursive: true, force: true });
    }
    console.log(JSON.stringify(report));
  `,
    ],
    {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '' },
      timeout: 15000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.public).toEqual({ status: 200, body: 'PUBLIC_FIXTURE' });
  expect(report.protected.status).toBe(401);
  expect(report.encodedProtected.status).toBe(401);
  expect(report.malformed.status).toBe(404);
  expect(report.malformed.body).not.toContain('PRIVATE_FIXTURE');
  expect(report.echo.status).toBe(200);
  expect(JSON.parse(report.echo.body)).toEqual({
    message: 'Prisma-compatible request',
  });
  expect(report.preservesGlobals).toBe(true);
}, 20000);

for (const key of [
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
]) {
  test(`deployment validation reports an invalid ${key} field without crashing error formatting`, () => {
    const schema = valibot.record(valibot.string(), valibot.number());
    const result = valibot.safeParse(schema, { [key]: 'invalid' });
    expect(result.success).toBe(false);
    expect(() => valibot.flatten(result.issues)).not.toThrow();
    expect(valibot.flatten(result.issues).nested[key]).toHaveLength(1);
  });
}

const katexPackage = installedDependency(
  'apps/docs/package.json',
  'mermaid',
  'katex',
);
const katex = katexPackage.require(katexPackage.root) as {
  renderToString(input: string, options?: Record<string, unknown>): string;
};

test('diagram math cannot inherit trust permission from the options prototype', () => {
  const options = Object.create({ trust: true });
  const html = katex.renderToString(
    String.raw`\href{https://example.com}{link}`,
    options,
  );
  expect(html).not.toContain('<a href=');
});

test('compiler archive detection terminates on a malformed zero-size ASF subheader', () => {
  const fileType = installedDependency(
    'package.json',
    '@swc/cli',
    '@xhmikosr/bin-wrapper',
    '@xhmikosr/downloader',
    'file-type',
  );
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const { fileTypeFromBuffer } = require(${JSON.stringify(fileType.root)});
    const input = Buffer.alloc(80);
    input.set([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9]);
    try { await fileTypeFromBuffer(input); } catch {}
    console.log(JSON.stringify({ completed: true }));
  `,
    ],
    { timeout: 2000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ completed: true });
}, 10000);

test('docs selector parsing retains the linear-time security backport', () => {
  const parser = installedDependency(
    'apps/docs/package.json',
    '@astrojs/starlight',
    'astro-expressive-code',
    'rehype-expressive-code',
    'expressive-code',
    '@expressive-code/core',
    'postcss-nested',
    'postcss-selector-parser',
  );
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const parser = require(${JSON.stringify(parser.root)});
    const count = 60000;
    const fastest = input => {
      let best = Infinity;
      for (let attempt = 0; attempt < 3; attempt++) {
        const start = performance.now();
        const tree = parser().astSync(input);
        if (tree.first.nodes.length < count) throw new Error('Selector nodes lost');
        best = Math.min(best, performance.now() - start);
      }
      return best;
    };
    const ratio = fastest('.a'.repeat(count)) / Math.max(fastest('.a '.repeat(count)), 1);
    console.log(JSON.stringify({ ratio }));
  `,
    ],
    { timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).ratio).toBeLessThan(2);
}, 40000);
