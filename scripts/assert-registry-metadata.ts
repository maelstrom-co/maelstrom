import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listPublishablePackages } from './lib/workspace-packages.ts';

// Nothing else in the release pipeline reads these fields: `publish-packages`
// only rewrites dependency specs, and `verify-published` only checks versions.
// Validate them before release preparation edits manifests and again in CI
// before packing, so incomplete metadata cannot reach publication.

const MIN_KEYWORDS = 3;
const EXPECTED_REPOSITORY = 'https://github.com/maelstrom-co/maelstrom.git';
const EXPECTED_REGISTRY = 'https://registry.npmjs.org';

type Manifest = {
  description?: string;
  keywords?: string[];
  license?: string;
  homepage?: string;
  bugs?: { url?: string };
  repository?: { directory?: string; url?: string };
  publishConfig?: { access?: string; registry?: string };
};

export type RegistryMetadataProblem = { file: string; message: string };

export function collectRegistryMetadataProblems(
  cwd: string = process.cwd(),
): RegistryMetadataProblem[] {
  const problems: RegistryMetadataProblem[] = [];
  const packages = listPublishablePackages(cwd);
  if (packages.length === 0) {
    return [{ file: 'package.json', message: 'No publishable packages found' }];
  }

  for (const pkg of packages) {
    // `file=` must be repo-relative for GitHub to anchor the annotation to the
    // file; an absolute runner path renders as an unlinked message.
    const file = relative(cwd, pkg.manifestPath);
    const fail = (message: string) => problems.push({ file, message });

    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(pkg.manifestPath, 'utf8')) as Manifest;
    } catch {
      fail(`${pkg.name} has an unreadable package.json`);
      continue;
    }

    if (!manifest.description?.trim()) fail(`${pkg.name} has no description`);
    if ((manifest.keywords?.length ?? 0) < MIN_KEYWORDS) {
      fail(
        `${pkg.name} has ${manifest.keywords?.length ?? 0} keywords, needs at least ${MIN_KEYWORDS}`,
      );
    }
    if (!manifest.license?.trim()) fail(`${pkg.name} has no license`);
    if (!manifest.homepage?.trim()) fail(`${pkg.name} has no homepage`);
    if (!manifest.bugs?.url?.trim()) fail(`${pkg.name} has no bugs.url`);

    if (manifest.repository?.url !== EXPECTED_REPOSITORY) {
      fail(
        `${pkg.name} repository.url must be "${EXPECTED_REPOSITORY}" so npm can verify the source repository`,
      );
    }
    if (manifest.publishConfig?.registry !== EXPECTED_REGISTRY) {
      fail(`${pkg.name} publishConfig.registry must be "${EXPECTED_REGISTRY}"`);
    }
    if (manifest.publishConfig?.access !== 'public') {
      fail(`${pkg.name} publishConfig.access must be "public"`);
    }
    if (
      Object.keys(manifest.publishConfig ?? {}).some(
        (key) => key !== 'registry' && key !== 'access',
      )
    ) {
      fail(`${pkg.name} publishConfig must contain only registry and access`);
    }

    // A wrong `repository.directory` sends every "view source" link on the
    // package page to a path that does not exist, and survives a rename.
    const directory = manifest.repository?.directory;
    if (!directory) {
      fail(`${pkg.name} has no repository.directory`);
    } else if (relative(cwd, pkg.dir) !== directory) {
      fail(
        `${pkg.name} declares repository.directory "${directory}" but lives at "${relative(cwd, pkg.dir)}"`,
      );
    }

    // npm renders README.md as the package page body and force-includes
    // LICENSE* from the package root. It does not reach the monorepo root.
    for (const required of ['README.md', 'LICENSE']) {
      if (!existsSync(join(pkg.dir, required))) {
        fail(`${pkg.name} has no ${required}`);
      }
    }
  }

  return problems;
}

export function assertRegistryMetadata(cwd: string = process.cwd()): void {
  const problems = collectRegistryMetadataProblems(cwd);
  for (const { file, message } of problems) {
    console.error(`::error file=${file}::${message}`);
  }
  if (problems.length > 0) {
    throw new Error('Registry metadata validation failed.');
  }

  console.log(
    `All ${listPublishablePackages(cwd).length} publishable packages carry complete registry metadata.`,
  );
}

if (import.meta.main) {
  try {
    assertRegistryMetadata();
  } catch {
    process.exitCode = 1;
  }
}
