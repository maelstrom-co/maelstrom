import { parseArgs } from 'node:util';
import { releaseChangelog, releasePublish, releaseVersion } from 'nx/release';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'dry-run': { type: 'boolean', short: 'd', default: true },
    verbose: { type: 'boolean', default: false },
    'skip-publish': { type: 'boolean', default: false },
  },
});

const dryRun = values['dry-run'] ?? true;
const verbose = values.verbose ?? false;

const { workspaceVersion, projectsVersionData, releaseGraph } =
  await releaseVersion({
    specifier: values.version,
    dryRun,
    verbose,
  });

await releaseChangelog({
  releaseGraph,
  versionData: projectsVersionData,
  version: workspaceVersion,
  dryRun,
  verbose,
});

if (values['skip-publish']) {
  console.log('Skipping publish.');
  process.exit(0);
}

const publishResults = await releasePublish({
  releaseGraph,
  dryRun,
  verbose,
});

process.exit(
  Object.values(publishResults).every((result) => result.code === 0) ? 0 : 1,
);
