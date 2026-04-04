import { parseArgs } from 'node:util';
import { releaseChangelog, releasePublish, releaseVersion } from 'nx/release';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'dry-run': { type: 'boolean', short: 'd', default: true },
    verbose: { type: 'boolean', default: false },
    'skip-publish': { type: 'boolean', default: false },
    'first-release': { type: 'boolean', default: false },
    preid: { type: 'string' },
  },
});

const dryRun = values['dry-run'] ?? true;
const verbose = values.verbose ?? false;
const firstRelease = values['first-release'] ?? false;
const preid = values.preid;

const { workspaceVersion, projectsVersionData, releaseGraph } =
  await releaseVersion({
    specifier: values.version,
    preid,
    firstRelease,
    dryRun,
    verbose,
  });

await releaseChangelog({
  releaseGraph,
  versionData: projectsVersionData,
  version: workspaceVersion,
  firstRelease,
  dryRun,
  verbose,
});

if (values['skip-publish']) {
  console.log('Skipping publish.');
  process.exit(0);
}

const publishResults = await releasePublish({
  releaseGraph,
  firstRelease,
  dryRun,
  verbose,
});

process.exit(
  Object.values(publishResults).every((result) => result.code === 0) ? 0 : 1,
);
