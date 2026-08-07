import { parseArgs } from 'node:util';
import { isAlreadyPublished, resolveRegistry } from './lib/registry.ts';
import { listPublishablePackages } from './lib/workspace-packages.ts';

// A green publish step is not proof the registry serves the packages: a
// partial publish, or one that failed after the tarball upload, both look the
// same from here. Ask the registry directly so a partial release fails loudly
// instead of being reported as a successful one.

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    registry: { type: 'string' },
    attempts: { type: 'string' },
    'retry-delay-ms': { type: 'string' },
  },
});

const version = values.version ?? '';
if (!version) {
  console.error('::error::Missing required --version');
  process.exit(1);
}

const registry = resolveRegistry(values.registry);
const attempts = Number(values.attempts ?? 5);
// Publishes are not immediately readable — the registry needs a moment to
// serve a version it just accepted, so absence is only meaningful after retry.
const retryDelayMs = Number(values['retry-delay-ms'] ?? 5000);

function isLive(name: string): boolean {
  try {
    return isAlreadyPublished(name, version, registry);
  } catch {
    return false;
  }
}

const missing: string[] = [];
for (const pkg of listPublishablePackages()) {
  let live = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (isLive(pkg.name)) {
      console.log(`✓ ${pkg.name}@${version} is live`);
      live = true;
      break;
    }
    if (attempt < attempts) {
      console.log(
        `… ${pkg.name}@${version} not visible yet (attempt ${attempt}/${attempts}), retrying`,
      );
      Bun.sleepSync(retryDelayMs);
    }
  }
  if (!live) {
    console.error(
      `::error::${pkg.name}@${version} not found on ${registry} after publish`,
    );
    missing.push(pkg.name);
  }
}

if (missing.length > 0) {
  console.error(`\nNot published: ${missing.join(', ')}`);
  process.exit(1);
}
