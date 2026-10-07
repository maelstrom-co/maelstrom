import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('browser tests reject an ordinary server that lacks the waitlist fixture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'www-playwright-startup-'));
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      return new URL(request.url).pathname === '/'
        ? new Response('Ordinary development server')
        : new Response('Not found', { status: 404 });
    },
  });

  try {
    const configPath = join(directory, 'playwright.config.ts');
    const appConfig = fileURLToPath(
      new URL('../../playwright.config.ts', import.meta.url),
    );
    await writeFile(
      configPath,
      `import config from ${JSON.stringify(appConfig)};
export default {
  ...config,
  testDir: ${JSON.stringify(directory)},
  outputDir: ${JSON.stringify(join(directory, 'results'))},
  reporter: [['json', { outputFile: ${JSON.stringify(join(directory, 'report.json'))} }]],
  retries: 0,
  webServer: { ...config.webServer, url: ${JSON.stringify(server.url.href)} },
};`,
    );
    await writeFile(
      join(directory, 'startup.spec.ts'),
      `import { test } from ${JSON.stringify(fileURLToPath(import.meta.resolve('@playwright/test')))};
test('startup completes', () => {});`,
    );

    const process = Bun.spawn(
      [
        'node',
        fileURLToPath(import.meta.resolve('@playwright/test/cli')),
        'test',
        '--config',
        configPath,
      ],
      {
        env: { ...Bun.env, CI: '', FORCE_COLOR: '0' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);

    expect(exitCode).toBe(1);
    const report = await readFile(join(directory, 'report.json'), 'utf8');
    expect(`${report}${stdout}${stderr}`).toContain('is already used');
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
