/**
 * Checks the How It Works examples against the published SDK packages: it
 * copies them into a temporary consumer outside the workspace, installs the
 * pinned versions with a frozen lockfile, typechecks them, parses their Vessel
 * and engine response with the published schemas, and asserts the installed
 * versions match the pin.
 *
 * The pin lives in `apps/docs/tools/skills/published-examples/package.json.template`
 * and its `bun.lock.template`, the single bump point per release for the docs
 * examples, this check, and the www FAQ version, so bump both files at every
 * release in the same change that updates the examples for the new API.
 */
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runConsumerCommand } from '../../docs/tools/skills/consumer-command';

const PUBLISHED_TEMPLATES = resolve(
  import.meta.dir,
  '../../docs/tools/skills/published-examples',
);
const EXAMPLES = resolve(import.meta.dir, '../src/examples/how-it-works');
const CONSUMER_TOOLS = ['check-example-schemas.ts', 'schema-field-coverage.ts'];

const consumer = await mkdtemp(join(tmpdir(), 'maelstrom-www-how-it-works-'));
try {
  for (const name of ['package.json', 'tsconfig.json', 'bun.lock']) {
    await copyFile(
      join(PUBLISHED_TEMPLATES, `${name}.template`),
      join(consumer, name),
    );
  }
  const examples = (await readdir(EXAMPLES))
    .filter((name) => !name.includes('.test.'))
    .sort();
  for (const name of examples) {
    await copyFile(join(EXAMPLES, name), join(consumer, name));
  }
  for (const name of CONSUMER_TOOLS) {
    await copyFile(join(import.meta.dir, name), join(consumer, name));
  }
  for (const args of [
    ['install', '--frozen-lockfile', '--ignore-scripts'],
    ['run', 'typecheck'],
    ['check-example-schemas.ts'],
  ]) {
    await runConsumerCommand(consumer, args);
  }
  console.log(
    JSON.stringify(
      {
        installed: await assertInstalledVersionsMatchPin(consumer),
        examples,
        verification:
          'TypeScript compilation and schema parsing only. No Engine, planner, or browser execution.',
      },
      null,
      2,
    ),
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}

async function assertInstalledVersionsMatchPin(
  directory: string,
): Promise<Record<string, string>> {
  const pinned = JSON.parse(
    await readFile(join(directory, 'package.json'), 'utf8'),
  ).dependencies as Record<string, string>;
  const installed: Record<string, string> = {};
  for (const [name, expected] of Object.entries(pinned)) {
    const { version } = JSON.parse(
      await readFile(
        join(directory, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    ) as { version: string };
    if (version !== expected) {
      throw new Error(`Expected ${name}@${expected}, installed ${version}.`);
    }
    installed[name] = version;
  }
  return installed;
}
