import { execFileSync, spawn } from 'node:child_process';
import {
  cp,
  glob,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from 'astro/markdown';
import { z } from 'astro/zod';

const fixtures = dirname(fileURLToPath(import.meta.url));
const app = resolve(fixtures, '../../..');
const repository = resolve(app, '../..');
const expectationSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  date: z.iso.date().transform((date) => new Date(`${date}T00:00:00Z`)),
  image: z.string().trim().min(1),
  author: z.string().trim().min(1),
  authorUrl: z.string().trim().min(1),
});

function childEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...process.env, ...overrides, NODE_OPTIONS: '' };
}

/**
 * Copies the extra-post fixture and its distinct local image into an existing temporary app.
 * Overwrites those two fixture paths on repeated calls; unlike inject, retains all other posts.
 */
export async function addExtraPost(root: string): Promise<void> {
  await cp(
    join(fixtures, 'fixture-extra.mdx'),
    join(root, 'src/content/blog/fixture-extra.mdx'),
  );
  await writeFile(
    join(root, 'public/fixture-extra.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>',
  );
}

/**
 * Reads source frontmatter, not rendered output; malformed expectation fields throw.
 * Returns all posts newest-first with ASCII slug tie-breaking, including an empty list.
 * An explicit root reads a temporary app instead of the production source tree.
 * Checks expectation fields independently; the actual build still validates the full blog schema.
 */
export async function sourcePosts(root = app) {
  const content = join(root, 'src/content/blog');
  const entries: string[] = [];
  for await (const entry of glob('**/*.mdx', { cwd: content })) {
    if ((await stat(join(content, entry))).isFile()) entries.push(entry);
  }
  const posts = await Promise.all(
    entries.map(async (entry) => ({
      id: entry.slice(0, -4),
      data: expectationSchema.parse(
        parseFrontmatter(await readFile(join(content, entry), 'utf8'))
          .frontmatter,
      ),
    })),
  );
  return posts.sort(
    (a, b) =>
      b.data.date.getTime() - a.data.date.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Copies production build inputs into a temporary app removed after the callback.
 * Inject replaces only that copy's blog with fixtures; real content and caches stay isolated.
 * Repeated builds retain the temporary content cache, and failed builds throw captured output.
 */
export async function withBlogBuild<T>(
  run: (site: {
    /** Isolated app directory; callers may mutate only this copy's content. */
    root: string;
    /** Client output directory, refreshed by Astro on each build. */
    output: string;
    /** Builds with the same cache, optionally overriding the site origin; throws on failure. */
    build: (site?: string) => void;
    /** Replaces temporary posts with the three controlled fixtures without deleting caches. */
    inject: () => Promise<void>;
    /** Runs a foreground dev server on an ephemeral port; always stops it before returning. */
    withDev: (run: (origin: string) => Promise<void>) => Promise<void>;
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
            '--disable-sigusr1',
            '--inspect-port=0',
            join(app, 'node_modules/astro/bin/astro.mjs'),
            'build',
            ...(site ? ['--site', site] : []),
          ],
          {
            cwd: root,
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
            env: childEnv({ ASTRO_TELEMETRY_DISABLED: '1' }),
            stdio: 'pipe',
          },
        );
      },
      async inject() {
        const content = join(root, 'src/content/blog');
        await rm(content, { recursive: true, force: true });
        await mkdir(content, { recursive: true });
        for (const slug of ['fixture-alpha', 'fixture-zeta', 'fixture-old']) {
          await cp(join(fixtures, `${slug}.mdx`), join(content, `${slug}.mdx`));
        }
      },
      async withDev(run) {
        const server = spawn(
          'node',
          [
            '--disable-sigusr1',
            '--inspect-port=0',
            join(app, 'node_modules/astro/bin/astro.mjs'),
            'dev',
            '--host',
            '127.0.0.1',
            '--port',
            '0',
          ],
          {
            cwd: root,
            env: childEnv({
              ASTRO_TELEMETRY_DISABLED: '1',
              ASTRO_DEV_BACKGROUND: '0',
            }),
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let logs = '';
        const closed = new Promise<void>((resolve) =>
          server.once('close', () => resolve()),
        );
        const ready = new Promise<string>((resolve, reject) => {
          const capture = (chunk: Buffer) => {
            logs += chunk.toString();
            const origin = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
            if (origin) resolve(origin);
          };
          server.stdout.on('data', capture);
          server.stderr.on('data', capture);
          server.once('error', reject);
          server.once('close', () => reject(new Error(logs)));
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const origin = await Promise.race([
            ready,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(new Error(`Dev server startup timed out: ${logs}`)),
                60_000,
              );
            }),
          ]);
          await run(origin);
        } finally {
          clearTimeout(timer);
          server.kill('SIGTERM');
          const force = setTimeout(() => server.kill('SIGKILL'), 5_000);
          try {
            await closed;
          } finally {
            clearTimeout(force);
          }
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
