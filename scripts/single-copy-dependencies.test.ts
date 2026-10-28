import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Two installed copies of these packages split shared state or break module
// resolution. A second @tanstack/react-store once crashed only the Vite dev
// server: the router's unbundled modules were rewritten to the app's
// pre-bundled older copy, while builds, typecheck, and tests all passed.
const SINGLE_COPY = [
  'react',
  'react-dom',
  '@tanstack/react-store',
  '@tanstack/store',
];

const lockfile = readFileSync(join(import.meta.dir, '..', 'bun.lock'), 'utf8');

test.each(SINGLE_COPY)('bun.lock resolves a single version of %s', (name) => {
  const versions = resolvedVersions(lockfile, name);
  expect(versions).toEqual([versions[0]]);
});

function resolvedVersions(source: string, name: string): string[] {
  // Nested installs are keyed by their install path, so match on the resolved
  // `name@version` that opens each entry instead.
  const entry = /^ {4}"[^"]+": \["((?:@[^@/"]+\/)?[^@"]+)@([^"]+)"/gm;
  const versions = new Set<string>();
  for (const [, entryName, version] of source.matchAll(entry)) {
    if (entryName === name) versions.add(version);
  }
  return [...versions];
}
