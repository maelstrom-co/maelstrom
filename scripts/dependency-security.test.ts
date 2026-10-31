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

test('custom credentials declared by another realm stop at the redirect origin boundary', () => {
  const proxy = installedDependency(
    'package.json',
    '@nx/web',
    'http-server',
    'http-proxy',
  );
  const result = spawnSync(
    Bun.which('node') ?? 'node',
    [
      '--input-type=module',
      '-e',
      `
    import { createRequire } from 'node:module';
    import { createServer } from 'node:http';
    import { runInNewContext } from 'node:vm';
    const require = createRequire(${JSON.stringify(join(proxy.root, 'package.json'))});
    const { http } = require('follow-redirects');
    const servers = [];
    const listen = async server => {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      return server.address().port;
    };
    let sourceHeader;
    let targetHeader;
    try {
      const target = await listen(createServer((request, response) => {
        targetHeader = request.headers['x-fixture-credential'] ?? null;
        response.end('ok');
      }));
      const source = await listen(createServer((request, response) => {
        sourceHeader = request.headers['x-fixture-credential'] ?? null;
        response.writeHead(302, { location: 'http://localhost:' + target + '/' });
        response.end();
      }));
      await new Promise((resolve, reject) => {
        const request = http.get('http://127.0.0.1:' + source + '/', {
          family: 4,
          headers: { 'X-Fixture-Credential': 'fixture-only' },
          sensitiveHeaders: runInNewContext('["X-Fixture-Credential"]'),
        }, response => {
          response.resume();
          response.on('end', resolve);
          response.on('error', reject);
        });
        request.on('error', reject);
        request.setTimeout(2000, () => request.destroy(new Error('Redirect fixture timed out')));
      });
      console.log(JSON.stringify({ sourceHeader, targetHeader }));
    } finally {
      await Promise.all(servers.map(server => new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
      })));
    }
  `,
    ],
    { timeout: 5000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    sourceHeader: 'fixture-only',
    targetHeader: null,
  });
}, 10000);

test('patched pattern matching still discovers nested API documentation entry points', () => {
  const typedoc = installedDependency('apps/docs/package.json', 'typedoc');
  const result = spawnSync(
    Bun.which('node') ?? 'node',
    [
      '--input-type=module',
      '-e',
      `
    import { Application } from ${JSON.stringify(join(typedoc.root, 'dist/index.js'))};
    import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const root = mkdtempSync(join(tmpdir(), 'docs-entrypoints-'));
    try {
      mkdirSync(join(root, 'src/nested'), { recursive: true });
      writeFileSync(join(root, 'src/alpha.ts'), 'export function fromAlpha(): string { return "alpha"; }');
      writeFileSync(join(root, 'src/nested/beta.ts'), 'export function fromBeta(): number { return 2; }');
      writeFileSync(join(root, 'src/ignored.ts'), 'export function internalOnly(): boolean { return true; }');
      writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', types: [] },
        include: ['src/**/*.ts'],
      }));
      const app = await Application.bootstrap({
        entryPoints: [join(root, 'src/**/*.ts')], entryPointStrategy: 'expand',
        exclude: ['**/ignored.ts'],
        tsconfig: join(root, 'tsconfig.json'), logLevel: 'None',
      });
      const project = await app.convert();
      if (!project) throw new Error('API documentation conversion failed');
      const names = [];
      const visit = reflection => {
        names.push(reflection.name);
        for (const child of reflection.children ?? []) visit(child);
      };
      visit(project);
      console.log(JSON.stringify({ names }));
    } finally { rmSync(root, { recursive: true, force: true }); }
  `,
    ],
    { timeout: 20000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  const resultNames = JSON.parse(result.stdout).names;
  expect(resultNames).toContain('fromAlpha');
  expect(resultNames).toContain('fromBeta');
  expect(resultNames).not.toContain('internalOnly');
}, 25000);

test('release project filters retain scoped names, dot names, exclusions, and invalid-pattern errors', () => {
  const nx = installedDependency('package.json', 'nx');
  const { getMatchingStringsWithCache } = nx.require(
    join(nx.root, 'dist/src/utils/find-matching-projects.js'),
  ) as {
    getMatchingStringsWithCache(pattern: string, items: string[]): string[];
  };
  const names = [
    '@maelstrom-co/client',
    '@maelstrom-co/engine',
    'regular',
    '.hidden',
  ];
  expect(getMatchingStringsWithCache('@maelstrom-co/*', names)).toEqual(
    names.slice(0, 2),
  );
  expect(getMatchingStringsWithCache('*', names)).toEqual([
    'regular',
    '.hidden',
  ]);
  expect(getMatchingStringsWithCache('!@maelstrom-co/engine', names)).toEqual([
    '@maelstrom-co/client',
    'regular',
    '.hidden',
  ]);
  expect(() => getMatchingStringsWithCache('#comment', names)).toThrow(
    'Invalid glob pattern',
  );
});

test('generator globs include pending files, hide deleted files, and honor exclusions', () => {
  const nx = installedDependency('package.json', 'nx');
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
    const require = createRequire(${JSON.stringify(join(nx.root, 'package.json'))});
    const { FsTree } = require('./dist/src/generators/tree.js');
    const { glob } = require('./dist/src/generators/utils/glob.js');
    const root = mkdtempSync(join(tmpdir(), 'generator-globs-'));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'nx.json'), '{}');
      writeFileSync(join(root, 'package.json'), '{"name":"fixture","private":true}');
      for (const name of ['kept.ts', 'deleted.ts', 'ignored.ts']) writeFileSync(join(root, 'src', name), 'export {};');
      const tree = new FsTree(root, false);
      tree.write('src/created.ts', 'export {};');
      tree.delete('src/deleted.ts');
      console.log(JSON.stringify(glob(tree, ['src/**/*.ts', '!src/ignored.ts']).sort()));
    } finally { rmSync(root, { recursive: true, force: true }); }
  `,
    ],
    { timeout: 10000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(['src/created.ts', 'src/kept.ts']);
}, 15000);

test('release branch patterns control whether baseline tags include unmerged branches', () => {
  const nx = installedDependency('package.json', 'nx');
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    import { mock } from 'bun:test';
    import { createRequire } from 'node:module';
    const require = createRequire(${JSON.stringify(join(nx.root, 'package.json'))});
    const commands = [];
    mock.module(${JSON.stringify(join(nx.root, 'dist/src/command-line/release/utils/exec-command.js'))}, () => ({
      execCommand: async (command, args) => {
        if (command !== 'git') throw new Error('Unexpected fixture command');
        if (args[0] === 'rev-parse') return 'release/fixture';
        if (!args.includes('tag')) throw new Error('Unexpected git fixture command');
        commands.push(args);
        return ['v0.2.0', 'v0.1.1', ''].join(String.fromCharCode(10));
      },
    }));
    const { RepoGitTags } = require('./dist/src/command-line/release/utils/repository-git-tags.js');
    const values = [];
    for (const patterns of [['release/*'], ['main*'], ['#comment']]) {
      values.push(await RepoGitTags.create().resolveTags(patterns));
    }
    console.log(JSON.stringify({ values, mergedOnly: commands.map(args => args.includes('--merged')) }));
  `,
    ],
    { timeout: 5000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    values: [
      ['v0.2.0', 'v0.1.1'],
      ['v0.2.0', 'v0.1.1'],
      ['v0.2.0', 'v0.1.1'],
    ],
    mergedOnly: [false, true, true],
  });
});

for (const [name, file, namespace, nocase] of [
  ['@verdaccio/core', 'auth-utils.js', 'auth_utils_exports', true],
  ['@verdaccio/core', 'auth-utils.mjs', 'auth_utils_exports', true],
  ['@verdaccio/utils', 'matcher.js', null, false],
  ['@verdaccio/utils', 'matcher.mjs', null, false],
] as const) {
  test(`local registry ${name} ${file} preserves package rule ordering and case policy`, () => {
    const dependency = installedDependency('package.json', 'verdaccio', name);
    const entry = join(dependency.root, 'build', file);
    const load = file.endsWith('.mjs')
      ? `import * as loaded from ${JSON.stringify(entry)};`
      : `import { createRequire } from 'node:module'; const loaded = createRequire(${JSON.stringify(join(dependency.root, 'package.json'))})(${JSON.stringify(entry)});`;
    const result = spawnSync(
      Bun.which('node') ?? 'node',
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      ${load}
      const match = ${namespace ? `loaded.${namespace}` : 'loaded'}.getMatchedPackagesSpec;
      const specific = { access: 'specific-fixture' };
      const fallback = { access: 'fallback-fixture' };
      const rules = { '@scope/*': specific, '**': fallback };
      assert.equal(match('@scope/item', rules), specific);
      assert.equal(match('plain', rules), fallback);
      assert.equal(match('@SCOPE/item', rules), ${nocase} ? specific : fallback);
      assert.equal(match('@scope/item', { '**': fallback, '@scope/*': specific }), fallback);
      assert.equal(match('@other/item', { '@scope/*': specific }), undefined);
      for (const pattern of ['', '#comment']) {
        assert.throws(() => match('plain', { [pattern]: specific, '**': fallback }), TypeError);
      }
      console.log(JSON.stringify({ checksPassed: true }));
    `,
      ],
      { timeout: 5000, encoding: 'utf8', maxBuffer: 1024 * 1024 },
    );
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ checksPassed: true });
  });
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
