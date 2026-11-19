import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { collectAuthoredExamples } from './authored-examples';
import { runConsumerCommand } from './consumer-command';

const revision = process.argv[2];
if (!revision)
  throw new Error('Pass the docs source revision or working-copy.');
const root = resolve(import.meta.dir, '../../../..');
const fixture = join(root, 'apps/docs/tools/skills/published-examples');
const directory = await mkdtemp(join(tmpdir(), 'maelstrom-authored-consumer-'));
try {
  const manifest = await readFile(
    join(fixture, 'package.json.template'),
    'utf8',
  );
  for (const name of ['package.json', 'tsconfig.json', 'bun.lock']) {
    await writeFile(
      join(directory, name),
      await readFile(join(fixture, `${name}.template`)),
    );
  }
  const files = await collectAuthoredExamples(root);
  for (const [name, source] of files) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await writeFile(join(directory, name), source);
  }
  for (const args of [
    ['install', '--frozen-lockfile', '--ignore-scripts'],
    ...(process.argv.includes('--audit') ? [['audit']] : []),
    ['run', 'typecheck'],
  ]) {
    await runConsumerCommand(directory, args);
  }
  const dependencies = JSON.parse(manifest).dependencies as Record<
    string,
    string
  >;
  const installed: Record<string, string> = {};
  for (const [name, expected] of Object.entries(dependencies)) {
    const actual = JSON.parse(
      await readFile(
        join(directory, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    ).version;
    if (actual !== expected)
      throw new Error(`Expected ${name}@${expected}, installed ${actual}.`);
    installed[name] = actual;
  }
  console.log(
    JSON.stringify(
      {
        docsRevision: revision,
        installed,
        examples: [...files.keys()],
        verification:
          'TypeScript compilation only; no provider, Engine, or browser execution.',
      },
      null,
      2,
    ),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
