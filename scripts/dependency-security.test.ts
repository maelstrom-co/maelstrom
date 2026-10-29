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

test('deployment static files cannot bypass protected-route middleware through a second path decode', () => {
  const prisma = installedDependency(
    'infra/platform/package.json',
    'alchemy',
    '@prisma/dev',
  );
  const result = spawnSync(
    Bun.which('node') ?? 'node',
    [
      '--input-type=module',
      '-e',
      `
    import { createRequire } from 'node:module';
    import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { get } from 'node:http';
    const require = createRequire(${JSON.stringify(join(prisma.root, 'package.json'))});
    const { Hono } = require('hono');
    const { serve } = require('@hono/node-server');
    const { serveStatic } = require('@hono/node-server/serve-static');
    const root = mkdtempSync(join(tmpdir(), 'deployment-static-'));
    mkdirSync(join(root, 'static/admin'), { recursive: true });
    writeFileSync(join(root, 'static/admin/secret.txt'), 'protected fixture');
    writeFileSync(join(root, 'static/public.txt'), 'public fixture');
    const app = new Hono();
    app.use('/static/admin/*', context => context.text('Unauthorized', 401));
    app.use('/static/*', serveStatic({ root }));
    let server;
    try {
      const info = await new Promise(resolve => {
        server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0, overrideGlobalObjects: false }, resolve);
      });
      const read = path => new Promise((resolve, reject) => {
        get({ hostname: '127.0.0.1', port: info.port, path }, response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => body += chunk);
          response.on('end', () => resolve({ status: response.statusCode, body }));
        }).on('error', reject);
      });
      console.log(JSON.stringify({
        public: await read('/static/public.txt'),
        protected: await read('/static/admin/secret.txt'),
        encoded: await read('/static/%%36%31dmin/secret.txt'),
      }));
    } finally {
      if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  `,
    ],
    { timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  const response = JSON.parse(result.stdout);
  expect(response.public).toEqual({ status: 200, body: 'public fixture' });
  expect(response.protected.status).toBe(401);
  expect(response.encoded.status).toBe(404);
  expect(response.encoded.body).not.toContain('protected fixture');
}, 15000);

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
