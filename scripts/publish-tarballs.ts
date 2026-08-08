import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  PACKED_MANIFEST_FILENAME,
  type PackedPackage,
} from './lib/packed-manifest.ts';
import {
  authenticationFailureHint,
  isAlreadyPublished,
  resolveRegistry,
} from './lib/registry.ts';

// The publishing half of the release. It runs in the only job that holds a
// GitHub Packages identity, and it deliberately does nothing that could execute
// dependency or package code: no install, no build, no project graph — just
// tarballs that another job already produced, uploaded one at a time.
//
// That separation is the point. `bun install` runs dependency lifecycle
// scripts and a build runs package code; either could access the package-write
// token. Keeping both out of this job means a compromised
// dependency has nothing to reach for.

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    tag: { type: 'string' },
    registry: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    provenance: { type: 'boolean', default: false },
    'skip-published': { type: 'boolean', default: false },
  },
});

const tag = values.tag;
if (!tag) {
  console.error('::error::Missing required --tag');
  process.exit(1);
}

const dir = resolve(process.cwd(), values.dir ?? 'dist/tarballs');
const registry = resolveRegistry(values.registry);
const dryRun = values['dry-run'];
const provenance = values.provenance;
const skipPublished = values['skip-published'];

let packages: PackedPackage[];
try {
  packages = JSON.parse(
    readFileSync(join(dir, PACKED_MANIFEST_FILENAME), 'utf8'),
  ) as PackedPackage[];
} catch (err) {
  console.error(
    `::error::Cannot read ${PACKED_MANIFEST_FILENAME} in ${dir}. ` +
      `The prepare job writes it next to the tarballs it packs.\n${
        err instanceof Error ? err.message : String(err)
      }`,
  );
  process.exit(1);
}

// An empty manifest means the prepare job packed nothing. Publishing zero
// packages would go green and report a successful release that never happened.
if (packages.length === 0) {
  console.error(`::error::${PACKED_MANIFEST_FILENAME} in ${dir} is empty.`);
  process.exit(1);
}

const failures: string[] = [];
const succeeded: string[] = [];
const skipped: string[] = [];

for (const pkg of packages) {
  if (skipPublished && !dryRun) {
    let already: boolean;
    try {
      already = isAlreadyPublished(pkg.name, pkg.version, registry);
    } catch (err) {
      // An indeterminate check is this package's failure, not the run's: the
      // rest can still go out, and the summary reports the whole picture
      // instead of stopping at the first unreachable lookup.
      console.error(err instanceof Error ? err.message : String(err));
      failures.push(pkg.name);
      continue;
    }
    if (already) {
      console.log(
        `Skipping ${pkg.name}@${pkg.version} (already on ${registry}).`,
      );
      skipped.push(pkg.name);
      continue;
    }
  }

  const args = [
    'publish',
    join(dir, pkg.tarball),
    '--tag',
    tag,
    '--registry',
    registry,
  ];
  if (dryRun) args.push('--dry-run');
  if (provenance) args.push('--provenance');

  console.log(
    `\n→ ${pkg.name}@${pkg.version} → ${registry} [tag=${tag}]${
      provenance ? ' (provenance)' : ''
    }${dryRun ? ' (dry-run)' : ''}`,
  );

  try {
    // No shell: `tag` derives from a git tag name, and a shell string here was
    // a confirmed injection into the one job that can publish packages.
    execFileSync('npm', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    succeeded.push(pkg.name);
  } catch {
    failures.push(pkg.name);
  }
}

const verb = dryRun ? 'Would publish' : 'Published';
console.log(
  `\n${verb} ${succeeded.length}, skipped ${skipped.length}, failed ${failures.length}.`,
);

if (failures.length > 0) {
  console.error(`\nPublish failed for: ${failures.join(', ')}`);
  console.error(authenticationFailureHint(registry));
  process.exit(1);
}
