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

const lockfile = readFileSync(
  join(import.meta.dirname, '..', 'bun.lock'),
  'utf8',
);
const versions = resolvedVersions(lockfile);

// A missing entry fails too, so a lockfile format the pattern no longer
// matches cannot pass without checking anything.
const failing = SINGLE_COPY.filter(
  (name) => (versions.get(name)?.size ?? 0) !== 1,
);
for (const name of failing) {
  const found = [...(versions.get(name) ?? [])];
  const message =
    found.length === 0
      ? `${name} has no entry in bun.lock`
      : `${name} resolves to ${found.join(' and ')}`;
  console.error(`::error file=bun.lock::${message}`);
}

if (failing.length > 0) process.exit(1);

console.log(`Single resolved version of ${SINGLE_COPY.join(', ')}.`);

function resolvedVersions(source: string): Map<string, Set<string>> {
  // Nested installs are keyed by their install path, so read the resolved
  // `name@version` that opens each entry instead.
  const entry = /^ {4}"[^"]+": \["((?:@[^@/"]+\/)?[^@"]+)@([^"]+)"/gm;
  const versions = new Map<string, Set<string>>();
  for (const [, name, version] of source.matchAll(entry)) {
    const seen = versions.get(name) ?? new Set<string>();
    seen.add(version);
    versions.set(name, seen);
  }
  return versions;
}
