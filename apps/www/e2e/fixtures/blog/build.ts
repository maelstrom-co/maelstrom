import { execFileSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = dirname(fileURLToPath(import.meta.url));
const app = resolve(fixtures, '../../..');
const repository = resolve(app, '../..');

/** Copies only build inputs; fixtures, caches and output never enter the real app. */
export async function withBlogBuild<T>(
  run: (site: {
    root: string;
    output: string;
    build: (site?: string) => void;
    inject: () => Promise<void>;
  }) => Promise<T>,
): Promise<T> {
  const temporary = await mkdtemp(join(tmpdir(), 'www-blog-'));
  const root = join(temporary, 'apps/www');
  try {
    await mkdir(root, { recursive: true });
    for (const path of [
      'src',
      'public',
      'astro.config.ts',
      'package.json',
      'tsconfig.json',
      'tsconfig.e2e.json',
    ]) {
      await cp(join(app, path), join(root, path), { recursive: true });
    }
    for (const path of ['node_modules', 'packages', 'infra']) {
      await symlink(join(repository, path), join(temporary, path), 'dir');
    }
    await mkdir(join(root, 'node_modules'));
    for (const dependency of await readdir(join(app, 'node_modules'))) {
      if (!dependency.startsWith('.')) {
        await symlink(
          join(app, 'node_modules', dependency),
          join(root, 'node_modules', dependency),
          'dir',
        );
      }
    }
    await cp(
      join(repository, 'tsconfig.base.json'),
      join(temporary, 'tsconfig.base.json'),
    );
    await cp(join(repository, 'package.json'), join(temporary, 'package.json'));
    return await run({
      root,
      output: join(root, 'dist/client'),
      build(site) {
        execFileSync(
          'node',
          [
            join(app, 'node_modules/astro/bin/astro.mjs'),
            'build',
            ...(site ? ['--site', site] : []),
          ],
          {
            cwd: root,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
            stdio: 'pipe',
          },
        );
      },
      async inject() {
        for (const slug of ['fixture-alpha', 'fixture-zeta', 'fixture-old']) {
          await cp(
            join(fixtures, `${slug}.mdx`),
            join(root, 'src/content/blog', `${slug}.mdx`),
          );
        }
      },
    });
  } finally {
    // Cleanup errors reject the test instead of leaving a silent fixture build behind.
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Reads emitted HTML or sitemap data from the isolated client output. */
export function outputText(output: string, path: string): Promise<string> {
  return readFile(join(output, path), 'utf8');
}
