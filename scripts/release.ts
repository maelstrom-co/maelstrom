import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { releaseChangelog, releaseVersion } from 'nx/release';
import { assertRegistryMetadata } from './assert-registry-metadata.ts';
import { versionFromTag } from './lib/release-target.ts';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'dry-run': { type: 'boolean', short: 'd', default: false },
    verbose: { type: 'boolean', default: false },
    'first-release': { type: 'boolean', default: false },
    preid: { type: 'string' },
  },
});

const dryRun = values['dry-run'];
const verbose = values.verbose;
const firstRelease = values['first-release'];

assertRegistryMetadata();

// Explicit overrides keep repository defaults from pushing unreviewed release
// changes. Preparation must also leave a colocated Jujutsu index untouched.
const localOnly = {
  stageChanges: false,
  gitCommit: false,
  gitTag: false,
  gitPush: false,
};
const { workspaceVersion, projectsVersionData, releaseGraph } =
  await releaseVersion({
    ...localOnly,
    specifier: values.version,
    preid: values.preid,
    firstRelease,
    dryRun,
    verbose,
  });

if (!workspaceVersion) {
  console.log('No package changes need a release.');
  process.exit(0);
}

const version = versionFromTag(`v${workspaceVersion}`);
const notesPath = join('.github', 'releases', `v${version}.md`);
const changelogResult = await releaseChangelog({
  ...localOnly,
  releaseGraph,
  versionData: projectsVersionData,
  version,
  firstRelease,
  dryRun,
  verbose,
  createRelease: false,
  // nx.json disables changelog files. Consume the custom renderer in memory
  // so the release PR can include its SDK-scoped notes without a remote release.
  forceChangelogGeneration: true,
});

const notes = changelogResult.workspaceChangelog?.contents;
if (!notes?.trim()) {
  throw new Error(
    'The release resolved no notes. Review the changelog configuration.',
  );
}

if (dryRun) {
  console.log(`Would write ${notesPath}:\n\n${notes}`);
} else {
  mkdirSync(dirname(notesPath), { recursive: true });
  writeFileSync(notesPath, `${notes.trim()}\n`, { flag: 'wx' });
  console.log(
    `Prepared ${version}. Review the manifests and ${notesPath} in a release PR.`,
  );
}

console.log(
  'After that PR merges, create the GitHub release from its merged commit. See CONTRIBUTING.md.',
);
