import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { runConsumerCommand } from './consumer-command';
import { createPublicDistributions } from './distribution';

const revision = process.argv[2];
if (!revision) throw new Error('Pass the full source commit SHA.');
const root = resolve(import.meta.dir, '../../../..');
const directory = await mkdtemp(join(tmpdir(), 'maelstrom-starter-consumer-'));
try {
  const { starter } = await createPublicDistributions(root, revision);
  for (const [name, bytes] of Object.entries(starter)) {
    const target = join(directory, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  for (const args of [
    ['install', '--frozen-lockfile', '--ignore-scripts'],
    ['audit'],
    ['run', 'lint'],
    ['run', 'format:check'],
    ['run', 'typecheck'],
    ['run', 'test'],
    ['run', 'build'],
    ['run', 'e2e'],
  ]) {
    await runConsumerCommand(directory, args);
  }
  for (const [name, expected] of Object.entries(starter)) {
    const actual = new Uint8Array(
      await Bun.file(join(directory, name)).arrayBuffer(),
    );
    if (!Buffer.from(expected).equals(actual))
      throw new Error(`Consumer checks rewrote a generated file: ${name}`);
  }
  console.log(
    'Exported starter passes its frozen install and consumer checks.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
