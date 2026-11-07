import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.each([
  { name: 'missing version stays absent', available: false },
  { name: 'matching version becomes available', available: true },
])(
  '$name at the selected registry despite competing scope configuration',
  async ({ available }) => {
    const directory = mkdtempSync(join(tmpdir(), 'maelstrom-registry-config-'));
    const name = '@maelstrom-co/client';
    const version = '1.2.3';
    const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
    const metadata = {
      name,
      'dist-tags': { latest: version },
      versions: { [version]: { name, version, dist: { integrity } } },
    };
    let configuredRequests = 0;
    let selectedRequests = 0;
    const configured = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        configuredRequests++;
        return Response.json(metadata);
      },
    });
    const selected = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        selectedRequests++;
        return available
          ? Response.json(metadata)
          : Response.json({ error: 'not found' }, { status: 404 });
      },
    });
    try {
      const scopedConfig = `@maelstrom-co:registry=${configured.url.href}\n`;
      const globalConfig = join(directory, 'global.npmrc');
      writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({ name: 'registry-fixture', private: true }),
      );
      writeFileSync(join(directory, '.npmrc'), scopedConfig);
      writeFileSync(globalConfig, scopedConfig);
      const source = new URL('./registry.ts', import.meta.url).href;
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          '--eval',
          `import { hasPublishedIntegrity } from ${JSON.stringify(source)};
          console.log(JSON.stringify(hasPublishedIntegrity(
            ${JSON.stringify(name)}, ${JSON.stringify(version)},
            ${JSON.stringify(selected.url.href)}, ${JSON.stringify(integrity)}, 10_000
          )));`,
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            HOME: directory,
            NPM_CONFIG_USERCONFIG: '/dev/null',
            NPM_CONFIG_GLOBALCONFIG: globalConfig,
            NPM_CONFIG_CACHE: join(directory, 'cache'),
            CI: 'true',
          },
          stdout: 'pipe',
          stderr: 'pipe',
          signal: AbortSignal.timeout(15_000),
        },
      );
      const [stdout, stderr, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(status, stderr).toBe(0);
      expect(JSON.parse(stdout)).toBe(available);
      expect(selectedRequests).toBeGreaterThan(0);
      expect(configuredRequests).toBe(0);
    } finally {
      await Promise.all([configured.stop(true), selected.stop(true)]);
      rmSync(directory, { recursive: true, force: true });
    }
  },
  20_000,
);
