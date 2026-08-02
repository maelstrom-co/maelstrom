import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { listPublishablePackages } from './lib/workspace-packages.ts';

// Versioning is fixed, so the tagged commit must already carry the tag's
// version in every publishable manifest. A mismatch means the tag points at a
// tree nobody reviewed — fail before anything is built or published.

const { values } = parseArgs({
  options: { version: { type: 'string' } },
});

const expected = values.version;
if (!expected) {
  console.error('::error::Missing required --version');
  process.exit(1);
}

const packages = listPublishablePackages();
if (packages.length === 0) {
  console.error('::error::No publishable packages found');
  process.exit(1);
}

const mismatched = packages.filter((pkg) => pkg.version !== expected);
for (const pkg of mismatched) {
  // `file=` must be repo-relative for GitHub to anchor the annotation to the
  // file; an absolute runner path renders as an unlinked message.
  const path = relative(process.cwd(), pkg.manifestPath);
  console.error(
    `::error file=${path}::${pkg.name} is at ${pkg.version} but the tag says ${expected}`,
  );
}

if (mismatched.length > 0) process.exit(1);

console.log(`All ${packages.length} publishable packages are at ${expected}.`);
