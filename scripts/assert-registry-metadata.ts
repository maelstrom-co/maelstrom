import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { listPublishablePackages } from './lib/workspace-packages.ts';

// Nothing else in the release pipeline reads these fields: `publish-packages`
// only rewrites dependency specs, and `verify-published` only checks versions.
// So every value here is load-bearing on the npm page and none of it is
// guarded — which is how a package can ship with a blank registry listing and
// a green CI run. This asserts the floor so package eleven cannot.

const MIN_KEYWORDS = 3;
const EXPECTED_REPOSITORY = 'https://github.com/maelstrom-co/maelstrom.git';
const EXPECTED_REGISTRY = 'https://npm.pkg.github.com';

type Manifest = {
  description?: string;
  keywords?: string[];
  license?: string;
  homepage?: string;
  bugs?: { url?: string };
  repository?: { directory?: string; url?: string };
  publishConfig?: { access?: string; registry?: string };
};

const problems: { file: string; message: string }[] = [];

const packages = listPublishablePackages();
if (packages.length === 0) {
  console.error('::error::No publishable packages found');
  process.exit(1);
}

for (const pkg of packages) {
  // `file=` must be repo-relative for GitHub to anchor the annotation to the
  // file; an absolute runner path renders as an unlinked message.
  const file = relative(process.cwd(), pkg.manifestPath);
  const fail = (message: string) => problems.push({ file, message });

  const manifest = JSON.parse(
    readFileSync(pkg.manifestPath, 'utf8'),
  ) as Manifest;

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
      `${pkg.name} repository.url must be "${EXPECTED_REPOSITORY}" so GitHub links the package to this repository`,
    );
  }
  if (manifest.publishConfig?.registry !== EXPECTED_REGISTRY) {
    fail(`${pkg.name} publishConfig.registry must be "${EXPECTED_REGISTRY}"`);
  }
  if (manifest.publishConfig?.access === 'public') {
    fail(`${pkg.name} must not request public package visibility`);
  }

  // A wrong `repository.directory` sends every "view source" link on the npm
  // page to a path that does not exist, and it survives a rename silently.
  const directory = manifest.repository?.directory;
  if (!directory) {
    fail(`${pkg.name} has no repository.directory`);
  } else if (relative(process.cwd(), pkg.dir) !== directory) {
    fail(
      `${pkg.name} declares repository.directory "${directory}" but lives at "${relative(process.cwd(), pkg.dir)}"`,
    );
  }

  // npm renders README.md as the entire package page body, and force-includes
  // LICENSE* from the package's own root — it does not reach the monorepo
  // root, so a missing local copy publishes MIT with no license text.
  for (const required of ['README.md', 'LICENSE']) {
    if (!existsSync(join(pkg.dir, required))) {
      fail(`${pkg.name} has no ${required}`);
    }
  }
}

for (const { file, message } of problems) {
  console.error(`::error file=${file}::${message}`);
}

if (problems.length > 0) process.exit(1);

console.log(
  `All ${packages.length} publishable packages carry complete registry metadata.`,
);
