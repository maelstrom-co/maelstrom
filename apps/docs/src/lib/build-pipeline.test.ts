import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('docs typechecking cannot regenerate reference pages while the site build reads them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'docs-task-order-'));
  const graphPath = join(directory, 'tasks.json');
  try {
    const process = Bun.spawn(
      [
        'bunx',
        'nx',
        'run',
        '@maelstrom-co/docs:typecheck',
        `--graph=${graphPath}`,
      ],
      {
        cwd: resolve(import.meta.dir, '../../../..'),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
    const graph = (await Bun.file(graphPath).json()) as {
      tasks: { dependencies: Record<string, string[]> };
    };
    const ancestors = new Set<string>();
    const visit = (id: string) => {
      for (const dependency of graph.tasks.dependencies[id] ?? []) {
        if (ancestors.has(dependency)) continue;
        ancestors.add(dependency);
        visit(dependency);
      }
    };
    visit('@maelstrom-co/docs:typecheck');
    expect(ancestors.has('@maelstrom-co/docs:build')).toBe(true);
    expect(ancestors.has('@maelstrom-co/docs:infra-typecheck')).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
