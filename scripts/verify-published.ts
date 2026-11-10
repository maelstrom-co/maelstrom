import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { readBoundedFile } from './lib/bounded-file.ts';
import { packedIntegrity } from './lib/packed-integrity.ts';
import { parsePackedManifest } from './lib/packed-manifest.ts';
import { waitForPublishedPackages } from './lib/published-packages.ts';
import { assertIntegrityRegistry, resolveRegistry } from './lib/registry.ts';

// A green publish step is not proof the registry serves the packages: a
// partial publish, or one that failed after the tarball upload, both look the
// same from here. Ask the registry directly so a partial release fails loudly
// instead of being reported as a successful one.

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    manifest: { type: 'string' },
    registry: { type: 'string' },
    attempts: { type: 'string' },
    'timeout-ms': { type: 'string' },
    'retry-delay-ms': { type: 'string' },
  },
});

const version = values.version ?? '';
if (!version) {
  console.error('::error::Missing required --version');
  process.exit(1);
}
const manifest = values.manifest ?? '';
if (!manifest) {
  console.error('::error::Missing required --manifest');
  process.exit(1);
}

const packages = parsePackedManifest(
  JSON.parse(readBoundedFile(manifest, 65_536).toString('utf8')) as unknown,
  version,
);

const registry = resolveRegistry(values.registry);
assertIntegrityRegistry(registry);
const missing = waitForPublishedPackages(
  packages.map((pkg) => pkg.name),
  {
    version,
    registry,
    integrities: new Map(
      packages.map((pkg) => [
        pkg.name,
        packedIntegrity({ tarballPath: join(dirname(manifest), pkg.tarball) }),
      ]),
    ),
    attempts:
      values.attempts === undefined ? undefined : Number(values.attempts),
    timeoutMs:
      values['timeout-ms'] === undefined
        ? undefined
        : Number(values['timeout-ms']),
    retryDelayMs:
      values['retry-delay-ms'] === undefined
        ? undefined
        : Number(values['retry-delay-ms']),
  },
);

if (missing.length > 0) {
  console.error(
    `::error::Availability not confirmed on ${registry}: ${missing.join(', ')}`,
  );
  console.error(
    'npm may still be scanning or reviewing accepted uploads. Check npm status and maintainer notifications before retrying publication.',
  );
  process.exit(1);
}
